import { sleep } from "./openai-http";
import { extractPdfPages } from "./extract-pdf";
import { createJobLogger, serializeError, type JobLogger } from "./log";
import {
	adjudicateLabSampleVsProtocol,
	extractLabSamplesFromManual,
	type LabSampleRow,
	type ProtocolMatchAdjudication,
} from "./notebook-llm";
import {
	buildProtocolIndex,
	extractProtocolFragment,
	findProtocolCandidates,
	labManualToPageMarkedText,
} from "./notebook-match";
import {
	getJobState,
	labObjectKey,
	protocolObjectKey,
	putJobState,
} from "./job-storage";
import type { JobState, ValidationReport, ValidationResultRow } from "./types";

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

/**
 * Pause between the two PDF→text runs (same gpt-4o TPM pool).
 * Default 55s when unset so both ~25k-token extracts rarely land in one minute.
 * Set OPENAI_PDF_EXTRACT_STAGGER_MS=0 to disable.
 */
function parsePdfExtractStaggerMs(env: Env): number {
	const raw = env.OPENAI_PDF_EXTRACT_STAGGER_MS?.trim();
	if (raw === undefined || raw === "") return 55_000;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 55_000;
	if (n === 0) return 0;
	return Math.min(n, 600_000);
}

function labSampleDisplay(lab: LabSampleRow): string {
	const parts = [lab.sample_type, lab.source_material, lab.collection_details]
		.map((x) => (typeof x === "string" ? x.trim() : ""))
		.filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : lab.source_text;
}

/** UI / report line length; prefer model evidence (short quote), not raw page windows. */
function clipProtocolDisplay(s: string | undefined, max: number): string | undefined {
	const t = s?.replace(/\s+/g, " ").trim();
	if (!t) return undefined;
	if (t.length <= max) return t;
	const cut = t.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	const head =
		lastSpace > max * 0.55 ? cut.slice(0, lastSpace).trimEnd() : cut.trimEnd();
	return `${head}…`;
}

function notebookRowToValidationRow(
	key: string,
	lab: LabSampleRow,
	match: ProtocolMatchAdjudication,
	protocolFragment: string | undefined
): ValidationResultRow {
	let status: ValidationResultRow["status"];
	if (match.status === "not_found") status = "lab_only";
	else if (match.status === "ambiguous") status = "conflict";
	else status = "aligned";

	const evidence = match.evidence?.replace(/\s+/g, " ").trim();
	const frag = protocolFragment?.replace(/\s+/g, " ").trim();

	// Match Jupyter-style rows: short protocol fragment from adjudication first;
	// mechanical page windows often start with template text when anchoring fails.
	const protocolSample =
		match.status === "not_found"
			? ""
			: clipProtocolDisplay(evidence, 360) ||
				clipProtocolDisplay(frag, 360) ||
				"—";

	let protocolEvidenceQuote: string | undefined;
	if (frag && evidence) {
		const needle = evidence.slice(0, Math.min(56, evidence.length)).trim();
		if (
			needle.length >= 10 &&
			frag.toLowerCase().includes(needle.toLowerCase())
		) {
			protocolEvidenceQuote = clipProtocolDisplay(frag, 1400);
		} else {
			protocolEvidenceQuote =
				clipProtocolDisplay(evidence, 1400) || clipProtocolDisplay(frag, 1400);
		}
	} else {
		protocolEvidenceQuote =
			clipProtocolDisplay(evidence, 1400) || clipProtocolDisplay(frag, 1400);
	}

	return {
		key,
		status,
		analysis: lab.sample_name,
		modelNote: match.rationale?.trim() || undefined,
		protocolSample,
		labSample: labSampleDisplay(lab),
		protocolTimepoints: [],
		labTimepoints: [],
		protocolDestination: "",
		labDestination: "",
		conflictFields:
			match.status === "ambiguous" ? ["unclear protocol match"] : undefined,
		protocolEvidencePage:
			match.protocol_page != null ? match.protocol_page : undefined,
		protocolEvidenceSection:
			match.protocol_section?.trim() || undefined,
		protocolEvidenceQuote,
		labEvidencePage: lab.manual_page,
		labEvidenceSection: lab.manual_section?.trim() || undefined,
		labEvidenceQuote: lab.source_text,
	};
}

/**
 * Notebook-style pipeline: PDF→text (OpenAI), lab manual structured extract,
 * fuzzball top-k protocol pages per sample, LLM adjudication per sample.
 */
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
			log.info("pdf_extract_stagger", { sec, reason: "tpm_spacing_between_pdfs" });
			await patchJob(env, jobId, log, {
				stageMessage: "Preparing laboratory manual…",
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

		const protocolPages = protocolPdf.pages;
		const protocolIndex = buildProtocolIndex(protocolPages);
		const pageMap = new Map(protocolPages.map((p) => [p.page, p.text]));

		log.info("notebook_pdf_ready", {
			protocolTotalPages: protocolPdf.totalPages,
			protocolIndexPages: protocolIndex.length,
			labTotalPages: labPdf.totalPages,
		});

		const labMarked = labManualToPageMarkedText(labPdf.pages);

		await patchJob(env, jobId, log, {
			status: "lab_llm",
			stageMessage: "Extracting samples from laboratory manual…",
		});
		const samples = await extractLabSamplesFromManual(env, labMarked, log);
		log.info("notebook_lab_samples", { count: samples.length });

		if (samples.length === 0) {
			const report: ValidationReport = {
				protocolRequirementCount: 0,
				labClaimCount: 0,
				rows: [],
			};
			await patchJob(env, jobId, log, {
				status: "done",
				stageMessage: "Complete",
				report,
			});
			log.info("pipeline_complete", {
				totalDurationMs: Date.now() - pipelineT0,
				note: "no_lab_samples",
			});
			return;
		}

		await patchJob(env, jobId, log, {
			status: "comparing",
			stageMessage: "Matching each lab sample to protocol pages…",
		});

		const rows: ValidationResultRow[] = [];
		const topK = 5;

		for (let i = 0; i < samples.length; i++) {
			const lab = samples[i]!;
			await patchJob(env, jobId, log, {
				stageMessage: `Protocol check ${i + 1}/${samples.length}: ${lab.sample_name.slice(0, 48)}…`,
			});

			const candidates = findProtocolCandidates(
				lab.sample_name,
				lab.source_text,
				protocolIndex,
				topK
			);
			const match = await adjudicateLabSampleVsProtocol(
				env,
				lab,
				candidates,
				log,
				i,
				samples.length
			);

			const fragment = extractProtocolFragment(
				pageMap,
				lab.sample_name,
				match.protocol_page,
				match.protocol_section,
				match.evidence
			);

			rows.push(
				notebookRowToValidationRow(`n-${i}`, lab, match, fragment)
			);
		}

		const withProtocolRef = rows.filter((r) => r.status !== "lab_only").length;
		const report: ValidationReport = {
			protocolRequirementCount: withProtocolRef,
			labClaimCount: samples.length,
			rows,
		};

		await patchJob(env, jobId, log, {
			status: "done",
			stageMessage: "Complete",
			report,
		});

		log.info("pipeline_complete", {
			totalDurationMs: Date.now() - pipelineT0,
			labSamples: samples.length,
			withProtocolRef,
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
