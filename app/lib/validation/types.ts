/** Shared DTOs for the protocol vs laboratory manual validation pipeline. */

export type JobStatus =
	| "queued"
	| "extracting"
	| "protocol_llm"
	| "lab_llm"
	| "comparing"
	| "done"
	| "error";

export type ExtractedRow = {
	analysis: string;
	specimen: string;
	timepoints: string[];
	destination?: string;
	evidencePage?: number;
	/** Section or heading reference, e.g. "10.1", "Table 14", "Appendix B". */
	evidenceSection?: string;
	evidenceQuote?: string;
};

export type ProtocolRequirement = ExtractedRow & { id: string };
export type LabClaim = ExtractedRow & { id: string };

export type ResultStatus = "aligned" | "conflict" | "protocol_only" | "lab_only";

export type ValidationResultRow = {
	key: string;
	status: ResultStatus;
	analysis: string;
	protocolSample: string;
	labSample: string;
	protocolTimepoints: string[];
	labTimepoints: string[];
	protocolDestination: string;
	labDestination: string;
	conflictFields?: string[];
	protocolEvidencePage?: number;
	protocolEvidenceSection?: string;
	protocolEvidenceQuote?: string;
	labEvidencePage?: number;
	labEvidenceSection?: string;
	labEvidenceQuote?: string;
	/** Short explanation from protocol-vs-lab adjudication (notebook-style pipeline). */
	modelNote?: string;
};

export type ValidationReport = {
	protocolRequirementCount: number;
	labClaimCount: number;
	rows: ValidationResultRow[];
};

export type JobState = {
	id: string;
	ownerEmail: string;
	status: JobStatus;
	stageMessage?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
	report?: ValidationReport;
	/** Bearer token for GET /api/jobs/:id when session cookie is missing (e.g. dev proxy). */
	pollToken?: string;
	/** Original upload names for OpenAI PDF extraction */
	protocolFileName?: string;
	labFileName?: string;
};

export type PdfPageText = { page: number; text: string };
