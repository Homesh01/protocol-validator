import type { JobLogger } from "./log";
import type { PdfPageText } from "./types";
import { extractPdfTextWithOpenAI } from "./openai-pdf-text";

export type { PdfPageText } from "./types";

/**
 * PDF text via OpenAI Responses API (PDF as input_file). Avoids PDF.js, which
 * does not run reliably on Cloudflare Workers (workerd).
 */
export async function extractPdfPages(
	env: Env,
	buffer: ArrayBuffer,
	log: JobLogger,
	label: string,
	filename: string
): Promise<{ totalPages: number; pages: PdfPageText[] }> {
	return log.timeAsync(
		`pdf_extract_${label}`,
		async () => {
			const { totalPages, pages } = await extractPdfTextWithOpenAI(
				env,
				buffer,
				filename,
				log,
				label
			);
			const nonEmpty = pages.filter((p) => p.text.length > 0).length;
			log.debug("pdf_pages_summary", {
				label,
				totalPages,
				nonEmptyPages: nonEmpty,
			});
			return { totalPages, pages };
		},
		{ bytes: buffer.byteLength, label }
	);
}

/** Pages that likely mention required specimen / sample types (protocol chunking). */
const SAMPLE_FOCUS_KEYWORD_RE =
	/\b(biospecimen|biological\s+material|specimen|sample\s+type|whole\s+blood|blood\s+draw|venous|plasma|serum|urine|saliva|stool|feces|csf|tissue|ffpe|formalin|paraffin|biopsy|tumor|swab|bone\s+marrow|pbmc|anticoagulant|edta|heparin|citrate|lithium|pk\s+sampling|pharmacokinetic\s+sample|fish\b|hybridis|hybridiz|immunophenotyp|immunohistochem|gene\s+expression|flow\s+cytom)\b/i;

/** Prefer pages about sample/specimen requirements; fall back to full protocol if none match. */
export function filterProtocolPages(pages: PdfPageText[]): PdfPageText[] {
	const hit = pages.filter((p) => SAMPLE_FOCUS_KEYWORD_RE.test(p.text));
	return hit.length > 0 ? hit : pages;
}

export function pagesToMarkedText(pages: PdfPageText[]): string {
	return pages
		.map((p) => `--- Page ${p.page} ---\n${p.text}`)
		.join("\n\n");
}

export function chunkText(
	full: string,
	maxLen: number,
	overlap: number
): string[] {
	if (full.length <= maxLen) return [full];
	const chunks: string[] = [];
	let start = 0;
	while (start < full.length) {
		const end = Math.min(start + maxLen, full.length);
		chunks.push(full.slice(start, end));
		if (end >= full.length) break;
		start = Math.max(0, end - overlap);
	}
	return chunks;
}

/** Cap how many LLM calls we make on the protocol document. */
export function limitChunks(chunks: string[], max: number): string[] {
	if (chunks.length <= max) return chunks;
	const merged: string[] = [];
	const groupSize = Math.ceil(chunks.length / max);
	for (let i = 0; i < chunks.length; i += groupSize) {
		merged.push(chunks.slice(i, i + groupSize).join("\n\n---\n\n"));
	}
	return merged;
}
