import type { ExtractedRow } from "./types";
import type { JobLogger } from "./log";
import { serializeError, truncateForLog } from "./log";
import { openaiFetchResilient } from "./openai-http";

function collectPageMarkersFromText(text: string): number[] {
	const seen = new Set<number>();
	for (const m of text.matchAll(/---\s*Page\s+(\d+)\s*---/gi)) {
		const n = Number.parseInt(m[1]!, 10);
		if (Number.isFinite(n)) seen.add(n);
	}
	return [...seen].sort((a, b) => a - b);
}

function parseEvidencePageField(v: unknown): number | undefined {
	if (v === null || v === undefined) return undefined;
	if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
	if (typeof v === "string") {
		const t = v.trim().toLowerCase();
		if (t === "" || t === "null") return undefined;
		const n = Number.parseInt(v.trim(), 10);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

/** When the model omits a quote, pull a window around the analysis/specimen substring in the chunk. */
function sliceQuoteAroundRowInChunk(
	chunk: string,
	row: ExtractedRow,
	maxLen: number
): string | undefined {
	const cand =
		row.analysis.trim().length >= 8
			? row.analysis.trim()
			: row.specimen.trim();
	if (cand.length < 8) return undefined;
	const take = Math.min(56, cand.length);
	const needle = cand.slice(0, take);
	const lower = chunk.toLowerCase();
	const idx = lower.indexOf(needle.toLowerCase());
	if (idx < 0) return undefined;
	const pad = 40;
	const start = Math.max(0, idx - pad);
	let s = chunk.slice(start, Math.min(chunk.length, start + maxLen + pad));
	s = s.replace(/\s+/g, " ").trim();
	if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`;
	return s;
}

function enrichRowsFromMarkedText(
	rows: ExtractedRow[],
	text: string,
	sectionFallbackLabel: "Protocol" | "Laboratory manual"
): ExtractedRow[] {
	const pages = collectPageMarkersFromText(text);
	const firstPage = pages[0];
	const lastPage = pages[pages.length - 1];
	return rows.map((r) => {
		const next = { ...r };
		if (next.evidencePage == null && firstPage != null) {
			next.evidencePage = firstPage;
		}
		if (!next.evidenceQuote?.trim()) {
			const q = sliceQuoteAroundRowInChunk(text, next, 220);
			if (q) next.evidenceQuote = q;
		}
		if (!next.evidenceSection?.trim()) {
			next.evidenceSection =
				pages.length === 1
					? `${sectionFallbackLabel} (PDF page ${firstPage})`
					: pages.length > 1
						? `${sectionFallbackLabel} (PDF pages ${firstPage}–${lastPage})`
						: `${sectionFallbackLabel} (no "--- Page N ---" markers in this text)`;
		}
		return next;
	});
}

function parseJsonFromModelContent(raw: string): unknown {
	const t = raw.trim();
	const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/);
	const s = fence ? fence[1].trim() : t;
	return JSON.parse(s) as unknown;
}

export type OpenAiCallMeta = { op: string; chunkIndex?: number };

export async function openaiChatJson<T>(
	env: Env,
	system: string,
	user: string,
	log: JobLogger,
	meta: OpenAiCallMeta
): Promise<T> {
	const model = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
	const t0 = Date.now();
	log.debug("openai_request", {
		op: meta.op,
		model,
		systemChars: system.length,
		userChars: user.length,
		chunkIndex: meta.chunkIndex,
	});

	const res = await openaiFetchResilient(
		"https://api.openai.com/v1/chat/completions",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				response_format: { type: "json_object" },
				temperature: 0.15,
			}),
		},
		log,
		meta.op,
		{ maxAttempts: 10 }
	);

	const durationMs = Date.now() - t0;

	if (!res.ok) {
		const err = await res.text();
		log.error("openai_http_error", {
			op: meta.op,
			status: res.status,
			durationMs,
			bodyPreview: truncateForLog(err, 500),
			chunkIndex: meta.chunkIndex,
		});
		throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 800)}`);
	}

	const data = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	};
	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		log.error("openai_empty_content", {
			op: meta.op,
			durationMs,
			chunkIndex: meta.chunkIndex,
		});
		throw new Error("OpenAI returned empty content");
	}

	log.info("openai_response", {
		op: meta.op,
		durationMs,
		model,
		contentChars: content.length,
		chunkIndex: meta.chunkIndex,
		promptTokens: data.usage?.prompt_tokens,
		completionTokens: data.usage?.completion_tokens,
		totalTokens: data.usage?.total_tokens,
	});

	try {
		return parseJsonFromModelContent(content) as T;
	} catch (e) {
		log.error("openai_json_parse_error", {
			op: meta.op,
			contentLength: content.length,
			parseErr: serializeError(e),
			chunkIndex: meta.chunkIndex,
		});
		throw new Error(`Invalid JSON from model (${meta.op})`);
	}
}

function isExtractedRow(x: unknown): x is ExtractedRow {
	if (!x || typeof x !== "object") return false;
	const o = x as Record<string, unknown>;
	return (
		typeof o.analysis === "string" &&
		typeof o.specimen === "string" &&
		o.specimen.trim().length > 0 &&
		Array.isArray(o.timepoints) &&
		o.timepoints.every((t) => typeof t === "string")
	);
}

export function parseRequirementsPayload(data: unknown): ExtractedRow[] {
	if (!data || typeof data !== "object") return [];
	const req = (data as { requirements?: unknown }).requirements;
	if (!Array.isArray(req)) return [];
	return req.filter(isExtractedRow).map((r) => {
		const o = r as ExtractedRow & { evidencePage?: unknown };
		return {
		analysis: r.analysis.trim(),
		specimen: r.specimen.trim(),
		timepoints: r.timepoints.map((t) => t.trim()).filter(Boolean),
		destination:
			typeof r.destination === "string" ? r.destination.trim() : undefined,
		evidencePage: parseEvidencePageField(o.evidencePage),
		evidenceSection:
			typeof r.evidenceSection === "string"
				? r.evidenceSection.trim()
				: undefined,
		evidenceQuote:
			typeof r.evidenceQuote === "string" ? r.evidenceQuote.trim() : undefined,
	};
	});
}

export function parseClaimsPayload(data: unknown): ExtractedRow[] {
	if (!data || typeof data !== "object") return [];
	const claims = (data as { claims?: unknown }).claims;
	if (!Array.isArray(claims)) return [];
	return claims.filter(isExtractedRow).map((r) => {
		const o = r as ExtractedRow & { evidencePage?: unknown };
		return {
		analysis: r.analysis.trim(),
		specimen: r.specimen.trim(),
		timepoints: r.timepoints.map((t) => t.trim()).filter(Boolean),
		destination:
			typeof r.destination === "string" ? r.destination.trim() : undefined,
		evidencePage: parseEvidencePageField(o.evidencePage),
		evidenceSection:
			typeof r.evidenceSection === "string"
				? r.evidenceSection.trim()
				: undefined,
		evidenceQuote:
			typeof r.evidenceQuote === "string" ? r.evidenceQuote.trim() : undefined,
	};
	});
}

const PROTOCOL_CHUNK_SYSTEM = `You are a clinical trial document analyst. From the excerpt (trial protocol), extract rows that pair each distinct laboratory test, assay, or analysis with the biological specimen or sample type required.

Include:
- Tables with ANALYSIS / ASSAY / TEST and SAMPLE / SPECIMEN / MATRIX columns: one JSON row per table row — copy the analysis column text into "analysis" (full wording, including e.g. "Fluorescence in situ hybridisation (FISH) and Gene expression profiling") and the sample column into "specimen".
- Prose sections that describe assays on tissue, blood, etc. (e.g. IHC, FISH, GEP, immunophenotyping, flow cytometry): one row per distinct test or panel, with a clear "analysis" label and the specimen/matrix in "specimen".
- Matrix/material: serum, plasma, whole blood, urine, FFPE blocks, biopsies, marrow, swabs, CSF, etc., including anticoagulant when it defines type (EDTA plasma vs serum).

Exclude pure visit schedules, visit windows, and shipping-only sentences unless they are the only place the specimen for a named test appears.

Fields:
- "analysis": the test/assay/procedure name as in the document (not a vague summary). Use "" only if the excerpt lists materials with no test name at all.
- "specimen": non-empty sample type description for that row.
- "timepoints": always [].
- Omit "destination".

Return strict JSON: { "requirements": [ { "analysis": string, "specimen": string, "timepoints": string[], "evidencePage": number | null, "evidenceSection": string, "evidenceQuote": string } ] }

Evidence (required for every row that you output):
- "evidencePage": integer — the PDF page number from the "--- Page N ---" line that appears immediately ABOVE this row's text in the excerpt (same N). If this excerpt truly has no "--- Page N ---" markers anywhere, use null.
- "evidenceSection": non-empty string — nearest numbered section heading, appendix title, or table caption in this excerpt (copy wording; e.g. "10.1 Formalin fixed paraffin embedded blocks", "Table 14 Laboratory samples").
- "evidenceQuote": non-empty string — copy verbatim from this excerpt (max ~240 chars) showing both the analysis/test name and specimen wording for this row.

If nothing in scope, return { "requirements": [] }.
No markdown, no commentary outside JSON.`;

const REDUCE_SYSTEM = `You merge duplicate protocol rows that describe the SAME test and SAME specimen wording. 

Do NOT merge rows that refer to different assays or tests (e.g. keep FISH separate from immunophenotyping, separate from GEP/TARC) even if they share the same specimen type like FFPE.

Return strict JSON: { "requirements": [ { "analysis": string, "specimen": string, "timepoints": string[], "evidencePage": number | null, "evidenceSection": string, "evidenceQuote": string } ] }
- Keep "timepoints" as [].
- EVERY output row MUST include evidencePage (number or null), evidenceSection (string), and evidenceQuote (string). Copy them from the input rows you merged—use the most specific quote and the page/section from the row that best matches the merged text. Never drop or empty these three fields.
No markdown.`;

const LAB_SYSTEM = `From the laboratory manual text, extract one row per distinct test/procedure that specifies or implies a required sample type.

Tables: if there are ANALYSIS and SAMPLE (or similar) columns, use one row per line — full analysis name in "analysis", sample/matrix in "specimen".
Prose: one row per test with its specimen requirement.

- "analysis": full test/procedure name when stated (e.g. immunophenotyping, FISH, gene expression profiling, TARC).
- "specimen": non-empty sample type(s) for that row.
- "timepoints": always [].
- Omit "destination".

Return strict JSON: { "claims": [ { "analysis": string, "specimen": string, "timepoints": string[], "evidencePage": number | null, "evidenceSection": string, "evidenceQuote": string } ] }

Evidence (required for every claim):
- "evidencePage": integer from the "--- Page N ---" line immediately above this row in the text, or null if no page markers exist.
- "evidenceSection": non-empty string — numbered section (e.g. "4.2 Sample collection"), chapter title, appendix name, or table title/caption visible near this row.
- "evidenceQuote": non-empty verbatim snippet (max ~240 chars) from the manual for this row.

No markdown.`;

export async function extractProtocolChunk(
	env: Env,
	chunk: string,
	index: number,
	total: number,
	log: JobLogger
): Promise<ExtractedRow[]> {
	const pages = collectPageMarkersFromText(chunk);
	const pageHint =
		pages.length > 0
			? `Page markers in this excerpt: ${pages.join(", ")}. Use the "--- Page N ---" that appears immediately above each table row or paragraph when setting evidencePage for that row.\n\n`
			: "This excerpt has no --- Page N --- markers; set evidencePage to null.\n\n";
	const user = `Excerpt ${index + 1} of ${total} from a trial protocol.\n${pageHint}\n${chunk}`;
	const raw = await openaiChatJson<unknown>(
		env,
		PROTOCOL_CHUNK_SYSTEM,
		user,
		log,
		{ op: "protocol_chunk", chunkIndex: index }
	);
	const rows = enrichRowsFromMarkedText(
		parseRequirementsPayload(raw),
		chunk,
		"Protocol"
	);
	log.debug("protocol_chunk_parsed", {
		chunkIndex: index,
		rowCount: rows.length,
	});
	return rows;
}

export async function reduceProtocolRequirements(
	env: Env,
	rows: ExtractedRow[],
	log: JobLogger,
	reducePass?: number
): Promise<ExtractedRow[]> {
	if (rows.length === 0) return [];
	const payload = JSON.stringify({ requirements: rows });
	const user = `Merge and deduplicate these protocol requirement rows:\n${payload}`;
	const raw = await openaiChatJson<unknown>(env, REDUCE_SYSTEM, user, log, {
		op: reducePass != null ? `reduce_pass_${reducePass}` : "reduce",
	});
	const out = parseRequirementsPayload(raw);
	log.debug("reduce_parsed", {
		pass: reducePass,
		inCount: rows.length,
		outCount: out.length,
	});
	return out;
}

export async function extractLabClaims(
	env: Env,
	labText: string,
	log: JobLogger
): Promise<ExtractedRow[]> {
	const pages = collectPageMarkersFromText(labText);
	const pageHint =
		pages.length > 0
			? `Page markers in the document: ${pages.join(", ")}. Set each claim's evidencePage to the page from the "--- Page N ---" line above that row.\n\n`
			: "";
	const user = `${pageHint}Laboratory manual text:\n\n${labText}`;
	const raw = await openaiChatJson<unknown>(env, LAB_SYSTEM, user, log, {
		op: "lab_manual",
	});
	const rows = enrichRowsFromMarkedText(
		parseClaimsPayload(raw),
		labText,
		"Laboratory manual"
	);
	log.debug("lab_manual_parsed", { rowCount: rows.length });
	return rows;
}
