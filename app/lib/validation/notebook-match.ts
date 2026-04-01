import { partial_ratio, token_set_ratio } from "fuzzball";
import type { PdfPageText } from "./types";

export type ProtocolIndexPage = {
	page_number: number;
	section?: string;
	text: string;
};

/** First plausible title-like line on the page (mirrors notebook guess_section). */
export function guessSection(text: string): string | undefined {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	for (const line of lines.slice(0, 20)) {
		if (line.length < 150 && /[A-Za-z]/.test(line)) return line;
	}
	return undefined;
}

export function buildProtocolIndex(pages: PdfPageText[]): ProtocolIndexPage[] {
	return pages.map((p) => ({
		page_number: p.page,
		section: guessSection(p.text),
		text: p.text,
	}));
}

/** Lab manual text with explicit page markers for the extraction model. */
export function labManualToPageMarkedText(pages: PdfPageText[]): string {
	return pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join("\n\n");
}

export function findProtocolCandidates(
	sampleName: string,
	sourceText: string,
	protocolIndex: ProtocolIndexPage[],
	topK = 5
): ProtocolIndexPage[] {
	const query = `${sampleName}\n${sourceText}`.trim().toLowerCase();
	const sn = sampleName.toLowerCase();
	const scored = protocolIndex.map((page) => {
		const textLower = page.text.toLowerCase();
		let score = Math.max(
			partial_ratio(sn, textLower),
			token_set_ratio(sn, textLower),
			partial_ratio(query, textLower)
		);
		if (textLower.includes(sn)) score += 20;
		return { page, score };
	});
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, topK).map((s) => s.page);
}

export function extractProtocolFragment(
	pageMap: Map<number, string>,
	sampleName: string,
	protocolPage: number | null | undefined,
	protocolSection: string | null | undefined,
	fallbackEvidence: string | null | undefined,
	windowBefore = 120,
	windowAfter = 220
): string | undefined {
	if (protocolPage == null || protocolPage < 1) {
		return fallbackEvidence?.trim() || undefined;
	}
	const text = pageMap.get(protocolPage) ?? "";
	if (!text.trim()) return fallbackEvidence?.trim() || undefined;
	const textClean = text.replace(/\s+/g, " ").trim();

	function findIdx(haystack: string, needle: string): number {
		const n = needle.replace(/\s+/g, " ").trim();
		if (n.length < 2) return -1;
		return haystack.toLowerCase().indexOf(n.toLowerCase());
	}

	const terms = [sampleName, protocolSection, fallbackEvidence];
	for (const term of terms) {
		if (!term) continue;
		const idx = findIdx(textClean, String(term));
		if (idx >= 0) {
			const span = String(term).length;
			const start = Math.max(0, idx - windowBefore);
			const end = Math.min(textClean.length, idx + span + windowAfter);
			return textClean.slice(start, end);
		}
	}
	return fallbackEvidence?.trim() || textClean.slice(0, 350);
}
