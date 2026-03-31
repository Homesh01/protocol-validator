import type { ExtractedRow } from "./types";

function norm(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.,;:!?'"()[\]]/g, "")
		.trim();
}

function tokenSet(s: string): Set<string> {
	return new Set(
		norm(s)
			.split(/\s+/)
			.filter((w) => w.length > 2)
	);
}

function jaccardStrings(a: string, b: string): number {
	const A = tokenSet(a);
	const B = tokenSet(b);
	if (A.size === 0 && B.size === 0) return 1;
	if (A.size === 0 || B.size === 0) return 0;
	let inter = 0;
	for (const t of A) {
		if (B.has(t)) inter++;
	}
	const union = A.size + B.size - inter;
	return union === 0 ? 0 : inter / union;
}

function rowSig(r: ExtractedRow): string {
	return `${r.analysis}\n${r.specimen}`;
}

/**
 * After reduce, merged rows often lose evidence fields. Copy from the closest
 * pre-merge chunk row (same analysis/specimen text).
 */
export function backfillMergedProtocolEvidence(
	merged: ExtractedRow[],
	chunkSourceRows: ExtractedRow[]
): ExtractedRow[] {
	if (chunkSourceRows.length === 0) return merged;
	return merged.map((m) => {
		let best: ExtractedRow | null = null;
		let bestScore = 0;
		for (const c of chunkSourceRows) {
			const score = jaccardStrings(rowSig(m), rowSig(c));
			if (score > bestScore) {
				bestScore = score;
				best = c;
			}
		}
		if (!best || bestScore < 0.22) return m;
		return {
			...m,
			evidencePage: m.evidencePage ?? best.evidencePage,
			evidenceSection:
				m.evidenceSection?.trim() || best.evidenceSection?.trim() || undefined,
			evidenceQuote: m.evidenceQuote?.trim() || best.evidenceQuote?.trim() || undefined,
		};
	});
}
