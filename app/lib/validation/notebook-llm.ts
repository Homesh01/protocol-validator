import type { JobLogger } from "./log";
import { openaiChatJson } from "./openai-client";
import type { ProtocolIndexPage } from "./notebook-match";

export type LabSampleRow = {
	sample_name: string;
	sample_type?: string | null;
	source_material?: string | null;
	collection_details?: string | null;
	manual_page: number;
	manual_section?: string | null;
	source_text: string;
};

export type ProtocolMatchAdjudication = {
	status: "found" | "not_found" | "ambiguous";
	protocol_page?: number | null;
	protocol_section?: string | null;
	evidence?: string | null;
	rationale?: string | null;
};

const LAB_EXTRACT_SYSTEM = `You are extracting all references to clinical trial samples from a laboratory manual.

Return every distinct sample that can be collected, processed, shipped, stored, or tested.

For each item, extract:
- sample_name (short label for the sample / test row)
- sample_type, source_material, collection_details (use null if not stated)
- manual_page: integer — must match the [PAGE N] marker for the page where this row appears
- manual_section: nearest section/table heading if visible, else null
- source_text: short verbatim snippet from the manual to verify the extraction

Rules:
- manual_page must come from the [PAGE N] markers in the document
- Include blood, serum, plasma, urine, saliva, tissue, PK, PD, biomarker, genomic, safety lab, central lab, local lab, and other sample-related references
- Do not invent items
- Output only valid JSON matching the schema below

Return JSON shape:
{ "samples": [ { "sample_name": string, "sample_type": string | null, "source_material": string | null, "collection_details": string | null, "manual_page": number, "manual_section": string | null, "source_text": string } ] }`;

const ADJUDICATE_SYSTEM = `You check whether a sample listed in a lab manual is clearly described in the clinical trial protocol excerpts you are given.

Return JSON only:
{ "status": "found" | "not_found" | "ambiguous", "protocol_page": number | null, "protocol_section": string | null, "evidence": string | null, "rationale": string | null }

Rules for status:
- found = the protocol clearly requires or describes this sample / assay context
- not_found = not supported by the excerpts
- ambiguous = possibly related but not clear enough

If found or ambiguous, set protocol_page and protocol_section to the best matching excerpt (use the [PROTOCOL PAGE N] and [SECTION] lines).
evidence = short quote from the excerpts. rationale = brief reason.
Be conservative: use not_found unless the protocol excerpts clearly support the lab entry.`;

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseLabSamplesPayload(data: unknown): LabSampleRow[] {
	if (!isRecord(data)) return [];
	const samples = data.samples;
	if (!Array.isArray(samples)) return [];
	const out: LabSampleRow[] = [];
	for (const item of samples) {
		if (!isRecord(item)) continue;
		const name = typeof item.sample_name === "string" ? item.sample_name.trim() : "";
		if (!name) continue;
		const page = item.manual_page;
		const manualPage =
			typeof page === "number" && Number.isFinite(page)
				? Math.trunc(page)
				: typeof page === "string"
					? Number.parseInt(page, 10)
					: NaN;
		if (!Number.isFinite(manualPage) || manualPage < 1) continue;
		const st = item.source_text;
		const sourceText = typeof st === "string" ? st.trim() : "";
		if (!sourceText) continue;
		out.push({
			sample_name: name,
			sample_type:
				typeof item.sample_type === "string" ? item.sample_type.trim() : null,
			source_material:
				typeof item.source_material === "string"
					? item.source_material.trim()
					: null,
			collection_details:
				typeof item.collection_details === "string"
					? item.collection_details.trim()
					: null,
			manual_page: manualPage,
			manual_section:
				typeof item.manual_section === "string"
					? item.manual_section.trim()
					: null,
			source_text: sourceText,
		});
	}
	return out;
}

function normalizeAdjudication(raw: unknown): ProtocolMatchAdjudication {
	if (!isRecord(raw)) {
		return { status: "ambiguous", rationale: "Invalid model output" };
	}
	const s = raw.status;
	let status: ProtocolMatchAdjudication["status"] = "ambiguous";
	if (s === "found" || s === "not_found" || s === "ambiguous") status = s;
	const pp = raw.protocol_page;
	let protocol_page: number | null | undefined =
		typeof pp === "number" && Number.isFinite(pp)
			? Math.trunc(pp)
			: typeof pp === "string"
				? Number.parseInt(pp, 10)
				: null;
	if (protocol_page !== undefined && protocol_page !== null && protocol_page < 1) {
		protocol_page = null;
	}
	return {
		status,
		protocol_page: protocol_page ?? null,
		protocol_section:
			typeof raw.protocol_section === "string"
				? raw.protocol_section.trim()
				: null,
		evidence: typeof raw.evidence === "string" ? raw.evidence.trim() : null,
		rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : null,
	};
}

export async function extractLabSamplesFromManual(
	env: Env,
	labMarkedText: string,
	log: JobLogger
): Promise<LabSampleRow[]> {
	const user = `Lab manual:\n\n${labMarkedText}`;
	const raw = await openaiChatJson<unknown>(
		env,
		LAB_EXTRACT_SYSTEM,
		user,
		log,
		{ op: "notebook_lab_extract" }
	);
	return parseLabSamplesPayload(raw);
}

export async function adjudicateLabSampleVsProtocol(
	env: Env,
	lab: LabSampleRow,
	candidates: ProtocolIndexPage[],
	log: JobLogger,
	sampleIndex: number,
	totalSamples: number
): Promise<ProtocolMatchAdjudication> {
	const candidateText = candidates
		.map(
			(c) =>
				`[PROTOCOL PAGE ${c.page_number}]\n[SECTION] ${c.section ?? "unknown"}\n${c.text.slice(0, 4000)}`
		)
		.join("\n\n");

	const user = `Lab manual entry:
- sample_name: ${lab.sample_name}
- sample_type: ${lab.sample_type ?? ""}
- source_material: ${lab.source_material ?? ""}
- collection_details: ${lab.collection_details ?? ""}
- manual_page: ${lab.manual_page}
- manual_section: ${lab.manual_section ?? ""}
- source_text: ${lab.source_text}

Candidate protocol excerpts (${candidates.length} pages):
${candidateText}`;

	const raw = await openaiChatJson<unknown>(
		env,
		ADJUDICATE_SYSTEM,
		user,
		log,
		{ op: "notebook_adjudicate", chunkIndex: sampleIndex }
	);
	log.debug("notebook_adjudicate_done", {
		sampleIndex,
		totalSamples,
		status: isRecord(raw) ? raw.status : "?",
	});
	return normalizeAdjudication(raw);
}
