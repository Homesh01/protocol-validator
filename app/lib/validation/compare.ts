import type {
	LabClaim,
	ProtocolRequirement,
	ValidationReport,
	ValidationResultRow,
} from "./types";
import type { JobLogger } from "./log";

function norm(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.,;:!?'"()[\]]/g, "")
		.trim();
}

function tokenSet(s: string): Set<string> {
	const words = norm(s)
		.split(/\s+/)
		.filter((w) => w.length > 2);
	return new Set(words);
}

function jaccard(a: string, b: string): number {
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

/** |A∩B|/min(|A|,|B|) — forgiving when one side is a long phrase and the other is shorter. */
function overlapCoefficient(a: string, b: string): number {
	const A = tokenSet(a);
	const B = tokenSet(b);
	if (A.size === 0 || B.size === 0) return 0;
	let inter = 0;
	for (const t of A) {
		if (B.has(t)) inter++;
	}
	return inter / Math.min(A.size, B.size);
}

function rowBlob(r: { analysis: string; specimen: string }): string {
	return `${r.analysis}\n${r.specimen}`;
}

/**
 * Match on analysis, specimen, and full row text. Handles cases where the protocol
 * encodes an assay name in `analysis` and the lab manual uses the same wording
 * across columns, or where token overlap is uneven between fields.
 */
function matchScore(req: ProtocolRequirement, claim: LabClaim): number {
	const ja = jaccard(req.analysis, claim.analysis);
	const js = jaccard(req.specimen, claim.specimen);
	const jc = jaccard(rowBlob(req), rowBlob(claim));
	const oc = overlapCoefficient(rowBlob(req), rowBlob(claim));
	return Math.min(
		1,
		Math.max(
			jc,
			oc * 0.96,
			ja * 0.42 + js * 0.42 + jc * 0.16,
			Math.max(ja, js) * 0.91
		)
	);
}

/** Minimum similarity to accept a pair (noise floor). */
const MATCH_SCORE_FLOOR = 0.19;

/** Expand common abbreviations so "FFPE" and "formalin fixed paraffin embedded" align. */
function expandSpecimenForMatch(s: string): string {
	const t = norm(s);
	return t
		.replace(/\bffpe\b/g, "formalin fixed paraffin embedded")
		.replace(/\bpbmcs?\b/g, "peripheral blood mononuclear cell")
		.replace(/\bwb\b/g, "whole blood");
}

/**
 * Similarity for sample-type wording: Jaccard is harsh when one side is a short
 * generic ("blood") and the other is specific ("peripheral blood in serum gel tube"),
 * or when FFPE is spelled out vs abbreviated. Use max of Jaccard, both overlap
 * directions, and Jaccard on expanded text.
 */
function specimenSimilarity(a: string, b: string): number {
	if (!a.trim() || !b.trim()) return 0;
	const js = jaccard(a, b);
	const ocAB = overlapCoefficient(a, b);
	const ocBA = overlapCoefficient(b, a);
	const jc = jaccard(expandSpecimenForMatch(a), expandSpecimenForMatch(b));
	return Math.max(js, ocAB, ocBA, jc);
}

/** Conflict only when sample types are genuinely different, not synonymous wording. */
const SPECIMEN_MATCH_MIN = 0.38;

function specimensConflict(
	req: ProtocolRequirement,
	claim: LabClaim
): boolean {
	return specimenSimilarity(req.specimen, claim.specimen) < SPECIMEN_MATCH_MIN;
}

/**
 * Lab-manual-first check: each laboratory manual row is matched to at most one
 * protocol requirement. We report aligned/conflict/lab-only rows only — protocol
 * requirements that never appear in the lab manual are intentionally omitted.
 */
export function compareProtocolToLab(
	requirements: ProtocolRequirement[],
	claims: LabClaim[],
	log: JobLogger
): ValidationReport {
	type Pair = { req: ProtocolRequirement; claim: LabClaim; score: number };
	type Scored = Pair & { claimId: string; reqId: string };
	const candidates: Scored[] = [];
	for (const claim of claims) {
		for (const req of requirements) {
			const score = matchScore(req, claim);
			if (score >= MATCH_SCORE_FLOOR) {
				candidates.push({
					req,
					claim,
					score,
					claimId: claim.id,
					reqId: req.id,
				});
			}
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	const usedReq = new Set<string>();
	const usedClaim = new Set<string>();
	const matches: Pair[] = [];
	for (const c of candidates) {
		if (usedClaim.has(c.claimId) || usedReq.has(c.reqId)) continue;
		usedClaim.add(c.claimId);
		usedReq.add(c.reqId);
		matches.push({ req: c.req, claim: c.claim, score: c.score });
	}

	const rows: ValidationResultRow[] = [];
	let k = 0;

	for (const { req, claim } of matches) {
		const fields: string[] = [];
		if (specimensConflict(req, claim)) fields.push("sample type");

		const status = fields.length > 0 ? "conflict" : "aligned";
		rows.push({
			key: `m-${k++}`,
			status,
			analysis:
				req.analysis.length >= claim.analysis.length ? req.analysis : claim.analysis,
			protocolSample: req.specimen,
			labSample: claim.specimen,
			protocolTimepoints: req.timepoints,
			labTimepoints: claim.timepoints,
			protocolDestination: req.destination ?? "",
			labDestination: claim.destination ?? "",
			conflictFields: fields.length > 0 ? fields : undefined,
			protocolEvidencePage: req.evidencePage,
			protocolEvidenceSection: req.evidenceSection,
			protocolEvidenceQuote: req.evidenceQuote,
			labEvidencePage: claim.evidencePage,
			labEvidenceSection: claim.evidenceSection,
			labEvidenceQuote: claim.evidenceQuote,
		});
	}

	const matchedClaimIds = new Set(matches.map((m) => m.claim.id));
	for (const claim of claims) {
		if (matchedClaimIds.has(claim.id)) continue;
		rows.push({
			key: `l-${claim.id}`,
			status: "lab_only",
			analysis: claim.analysis,
			protocolSample: "",
			labSample: claim.specimen,
			protocolTimepoints: [],
			labTimepoints: claim.timepoints,
			protocolDestination: "",
			labDestination: claim.destination ?? "",
			labEvidencePage: claim.evidencePage,
			labEvidenceSection: claim.evidenceSection,
			labEvidenceQuote: claim.evidenceQuote,
		});
	}

	const report: ValidationReport = {
		protocolRequirementCount: requirements.length,
		labClaimCount: claims.length,
		rows,
	};

	const byStatus = {
		aligned: 0,
		conflict: 0,
		lab_only: 0,
	};
	for (const r of rows) {
		byStatus[r.status]++;
	}
	const protocolUnmatched = requirements.filter((r) => !usedReq.has(r.id))
		.length;
	log.info("compare_complete", {
		protocolRequirementCount: report.protocolRequirementCount,
		labClaimCount: report.labClaimCount,
		resultRowCount: rows.length,
		matchedPairs: matches.length,
		protocolRequirementsNotInReport: protocolUnmatched,
		...byStatus,
	});

	return report;
}
