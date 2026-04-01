import type { JobLogger } from "./log";
import type { PdfPageText } from "./types";
import { extractPdfTextWithOpenAI } from "./openai-pdf-text";

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
