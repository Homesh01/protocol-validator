import { sleep } from "./openai-http";
import { compareProtocolToLab } from "./compare";
import {
	chunkText,
	extractPdfPages,
	filterProtocolPages,
	limitChunks,
	pagesToMarkedText,
} from "./extract-pdf";
import { createJobLogger, serializeError, type JobLogger } from "./log";
import { backfillMergedProtocolEvidence } from "./evidence-backfill";
import {
	extractLabClaims,
	extractProtocolChunk,
	reduceProtocolRequirements,
} from "./openai-client";
import {
	getJobState,
	labObjectKey,
	protocolObjectKey,
	putJobState,
} from "./job-storage";
import type {
	ExtractedRow,
	JobState,
	LabClaim,
	ProtocolRequirement,
} from "./types";

const PROTOCOL_CHUNK_SIZE = 6500;
const PROTOCOL_CHUNK_OVERLAP = 450;
const MAX_PROTOCOL_CHUNKS = 22;

async function patchJob(
	env: Env,
	jobId: string,
	log: JobLogger,
	patch: Partial<JobState>
): Promise<void> {
	log.debug("job_state_patch", {
		nextStatus: patch.status,
		stageMessage: patch.stageMessage,
		hasError: Boolean(patch.error),
	});
	const prev = await getJobState(env.VALIDATION_R2, jobId);
	const base: JobState =
		prev ??
		({
			id: jobId,
			ownerEmail: "",
			status: "queued",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		} satisfies JobState);
	const next: JobState = {
		...base,
		...patch,
		updatedAt: Date.now(),
	};
	await putJobState(env.VALIDATION_R2, next);
}

const REDUCE_BATCH = 50;
const REDUCE_ROUNDS = 12;

/** Pause between the two PDF→text runs (same gpt-4o TPM pool); 0 = off. */
function parsePdfExtractStaggerMs(env: Env): number {
	const raw = env.OPENAI_PDF_EXTRACT_STAGGER_MS?.trim();
	if (!raw) return 0;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(n, 600_000);
}

async function reduceInBatches(
	env: Env,
	rows: ExtractedRow[],
	log: JobLogger
): Promise<ExtractedRow[]> {
	if (rows.length === 0) return [];
	let reduceCallSeq = 0;
	let current = [...rows];
	for (let round = 0; round < REDUCE_ROUNDS && current.length > REDUCE_BATCH; round++) {
		const next: ExtractedRow[] = [];
		for (let i = 0; i < current.length; i += REDUCE_BATCH) {
			const batch = current.slice(i, i + REDUCE_BATCH);
			const merged = await reduceProtocolRequirements(
				env,
				batch,
				log,
				reduceCallSeq++
			);
			next.push(...merged);
		}
		if (next.length === 0) return [];
		if (next.length >= current.length) {
			current = next;
			break;
		}
		current = next;
	}
	return reduceProtocolRequirements(env, current, log, reduceCallSeq++);
}

export async function runValidationPipeline(jobId: string, env: Env): Promise<void> {
	const log = createJobLogger(jobId);
	const pipelineT0 = Date.now();
	log.info("pipeline_start");

	try {
		await patchJob(env, jobId, log, {
			status: "extracting",
			stageMessage: "Reading PDFs…",
			error: undefined,
		});

		const protocolObj = await env.VALIDATION_R2.get(protocolObjectKey(jobId));
		const labObj = await env.VALIDATION_R2.get(labObjectKey(jobId));
		if (!protocolObj || !labObj) {
			throw new Error("Uploaded files missing from storage");
		}

		const protocolBuf = await protocolObj.arrayBuffer();
		const labBuf = await labObj.arrayBuffer();

		const jobMeta = await getJobState(env.VALIDATION_R2, jobId);
		const protocolFileName = jobMeta?.protocolFileName ?? "protocol.pdf";
		const labFileName = jobMeta?.labFileName ?? "lab.pdf";

		const protocolPdf = await extractPdfPages(
			env,
			protocolBuf,
			log,
			"protocol",
			protocolFileName
		);

		const staggerMs = parsePdfExtractStaggerMs(env);
		if (staggerMs > 0) {
			const sec = Math.round(staggerMs / 1000);
			await patchJob(env, jobId, log, {
				stageMessage: `Pausing ${sec}s before laboratory manual (spreads gpt-4o usage for rate limits)…`,
			});
			await sleep(staggerMs);
		}
		await patchJob(env, jobId, log, {
			stageMessage: "Reading laboratory manual PDF…",
		});

		const labPdf = await extractPdfPages(
			env,
			labBuf,
			log,
			"lab",
			labFileName
		);

		const protocolPages = filterProtocolPages(protocolPdf.pages);
		const protocolMarked = pagesToMarkedText(protocolPages);
		let chunks = chunkText(
			protocolMarked,
			PROTOCOL_CHUNK_SIZE,
			PROTOCOL_CHUNK_OVERLAP
		);
		chunks = limitChunks(chunks, MAX_PROTOCOL_CHUNKS);

		log.info("protocol_text_prepared", {
			protocolTotalPages: protocolPdf.totalPages,
			protocolPagesAfterFilter: protocolPages.length,
			chunkCount: chunks.length,
			protocolMarkedChars: protocolMarked.length,
			labTotalPages: labPdf.totalPages,
		});

		await patchJob(env, jobId, log, {
			status: "protocol_llm",
			stageMessage: `Extracting required sample types from protocol (${chunks.length} sections)…`,
		});

		const chunkRows: ExtractedRow[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const rows = await extractProtocolChunk(
				env,
				chunks[i],
				i,
				chunks.length,
				log
			);
			chunkRows.push(...rows);
			await patchJob(env, jobId, log, {
				stageMessage: `Protocol extraction ${i + 1}/${chunks.length}…`,
			});
		}

		log.info("protocol_chunks_extracted", {
			rawRowCount: chunkRows.length,
		});

		await patchJob(env, jobId, log, {
			stageMessage: "Merging protocol sample-type rows…",
		});
		const mergedRows = await reduceInBatches(env, chunkRows, log);
		const mergedWithEvidence = backfillMergedProtocolEvidence(
			mergedRows,
			chunkRows
		);
		const requirements: ProtocolRequirement[] = mergedWithEvidence.map(
			(r) => ({
				...r,
				id: crypto.randomUUID(),
			})
		);

		log.info("protocol_requirements_final", {
			count: requirements.length,
		});

		const labMarked = pagesToMarkedText(labPdf.pages);
		await patchJob(env, jobId, log, {
			status: "lab_llm",
			stageMessage: "Extracting sample types from laboratory manual…",
		});
		const labExtracted = await extractLabClaims(env, labMarked, log);
		const claims: LabClaim[] = labExtracted.map((c) => ({
			...c,
			id: crypto.randomUUID(),
		}));

		log.info("lab_claims_final", { count: claims.length });

		await patchJob(env, jobId, log, {
			status: "comparing",
			stageMessage: "Checking lab manual sample types against trial protocol…",
		});
		const report = compareProtocolToLab(requirements, claims, log);

		await patchJob(env, jobId, log, {
			status: "done",
			stageMessage: "Complete",
			report,
		});

		log.info("pipeline_complete", {
			totalDurationMs: Date.now() - pipelineT0,
		});
	} catch (e) {
		const err = serializeError(e);
		log.error("pipeline_failed", { err, totalDurationMs: Date.now() - pipelineT0 });
		const message = e instanceof Error ? e.message : String(e);
		await patchJob(env, jobId, log, {
			status: "error",
			error: message,
			stageMessage: undefined,
		});
	}
}
