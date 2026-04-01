import { Fragment, useRef, useState } from "react";
import type { MetaFunction } from "@remix-run/cloudflare";
import type { ValidationReport, ValidationResultRow } from "~/lib/validation/types";

export const meta: MetaFunction = () => {
	return [
		{ title: "Protocol Validator | Insynctrials" },
		{
			name: "description",
			content:
				"Upload your trial protocol and lab manual—see whether required sample types line up before startup.",
		},
	];
};

function statusStyles(status: ValidationResultRow["status"]): string {
	switch (status) {
		case "aligned":
			return "bg-emerald-900/40 text-emerald-300 border-emerald-700/50";
		case "conflict":
			return "bg-amber-900/40 text-amber-200 border-amber-700/50";
		case "protocol_only":
			return "bg-sky-900/40 text-sky-200 border-sky-700/50";
		case "lab_only":
			return "bg-rose-900/40 text-rose-200 border-rose-700/50";
		default:
			return "bg-gray-800 text-gray-300 border-gray-600";
	}
}

function statusLabel(status: ValidationResultRow["status"]): string {
	switch (status) {
		case "aligned":
			return "Aligned";
		case "conflict":
			return "Needs review";
		case "protocol_only":
			return "Only in protocol (legacy)";
		case "lab_only":
			return "Not in trial protocol";
		default:
			return status;
	}
}

function rowTitle(r: ValidationResultRow): string {
	const a = r.analysis?.trim();
	if (a) return a;
	return r.labSample || r.protocolSample || "—";
}

function SourceCitation({
	title,
	page,
	section,
	quote,
	variant,
}: {
	title: string;
	page?: number;
	section?: string;
	quote?: string;
	variant: "protocol" | "lab";
}) {
	const hasLocation =
		page != null ||
		Boolean(section?.trim()) ||
		Boolean(quote?.trim());
	if (!hasLocation) {
		return (
			<p className="mt-3 border-t border-gray-700/50 pt-3 text-xs text-gray-500">
				No page, section, or quote was captured for this row. If the PDF is
				image-based, try a text-based export; otherwise re-run validation after
				updates to extraction.
			</p>
		);
	}
	return (
		<div className="mt-3 space-y-2 border-t border-gray-700/50 pt-3 text-xs text-gray-400">
			<p className="font-semibold uppercase tracking-wider text-gray-500">
				{title}
			</p>
			<ul className="list-none space-y-1.5 pl-0">
				{page != null && (
					<li>
						<span className="text-gray-500">Page: </span>
						<span className="text-gray-300">{page}</span>
					</li>
				)}
				{section?.trim() && (
					<li>
						<span className="text-gray-500">Section / table: </span>
						<span className="text-gray-300">{section.trim()}</span>
					</li>
				)}
				{quote?.trim() && (
					<li>
						<span className="mb-1 block text-gray-500">Excerpt:</span>
						<blockquote
							className={`border-l-2 pl-3 text-gray-300 ${
								variant === "lab"
									? "border-rose-600/45"
									: "border-sky-600/50"
							}`}
						>
							{quote.trim()}
						</blockquote>
					</li>
				)}
			</ul>
		</div>
	);
}

function CyclingLoadingBar({ label }: { label: string }) {
	return (
		<div
			className="space-y-2"
			role="progressbar"
			aria-busy="true"
			aria-valuetext={label}
		>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800/90 ring-1 ring-gray-700/50">
				<div
					className="h-full w-full origin-left animate-loading-bar-fill bg-gradient-to-r from-[#6f40ff] via-[#a855f7] to-[#da016e] will-change-transform motion-reduce:animate-none"
					aria-hidden
				/>
			</div>
		</div>
	);
}

function SummaryTable({ rows }: { rows: ValidationResultRow[] }) {
	const [expandedIndices, setExpandedIndices] = useState<Set<number>>(
		new Set()
	);

	const toggleRow = (index: number) => {
		setExpandedIndices((prev) => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	};

	const expandAll = () => {
		setExpandedIndices(new Set(rows.map((_, i) => i)));
	};

	const collapseAll = () => {
		setExpandedIndices(new Set());
	};

	const allExpanded = expandedIndices.size === rows.length;

	return (
		<div className="space-y-4">
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={expandAll}
					disabled={allExpanded}
					className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-700/80 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Show all details
				</button>
				<button
					type="button"
					onClick={collapseAll}
					disabled={expandedIndices.size === 0}
					className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-700/80 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Hide all details
				</button>
			</div>
			<div className="summary-table-scroll max-h-[40rem] overflow-x-auto overflow-y-auto rounded-xl border border-gray-700">
				<table className="w-full">
					<thead className="sticky top-0 z-10">
						<tr className="border-b border-gray-700 bg-gray-800">
							<th className="px-3 py-3 text-left text-sm font-semibold text-gray-300">
								Status
							</th>
							<th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
								Sample requirement
							</th>
							<th className="w-10 px-2 py-3" aria-label="Expand" />
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => {
							const isExpanded = expandedIndices.has(index);
							return (
								<Fragment key={row.key}>
									<tr
										onClick={() => toggleRow(index)}
										className="cursor-pointer border-b border-gray-700/50 transition-colors hover:bg-gray-800/50"
									>
										<td className="px-3 py-3">
											<span
												className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusStyles(row.status)}`}
											>
												{statusLabel(row.status)}
											</span>
										</td>
										<td className="px-4 py-3 text-sm text-white">
											{rowTitle(row)}
										</td>
										<td className="px-2 py-3">
											<span
												className={`inline-block transition-transform ${
													isExpanded ? "rotate-180" : ""
												}`}
											>
												▼
											</span>
										</td>
									</tr>
									{isExpanded && (
										<tr>
											<td
												colSpan={3}
												className="bg-gray-800/30 px-4 py-4"
											>
												{row.conflictFields &&
													row.conflictFields.length > 0 && (
														<p className="mb-3 text-sm text-amber-200/90">
															<strong className="font-medium">
																Review:
															</strong>{" "}
															{row.conflictFields.join(", ")}
														</p>
													)}
												{row.analysis.trim().length > 0 && (
													<p className="mb-3 text-sm text-gray-400">
														<span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
															Sample / assay{" "}
														</span>
														{row.analysis}
													</p>
												)}
												{row.modelNote?.trim() && (
													<p className="mb-3 text-sm text-gray-400">
														<span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
															Model note{" "}
														</span>
														{row.modelNote}
													</p>
												)}
												<div className="grid gap-6 lg:grid-cols-2">
													<div className="rounded-lg border border-gray-700/80 bg-gray-900/40 p-4">
														<p className="mb-3 text-xs font-semibold uppercase tracking-wider text-sky-300/90">
															Trial protocol
														</p>
														<div className="text-sm text-gray-300">
															<p className="mb-0.5 text-xs text-gray-500">
																Required sample type
															</p>
															<p className="text-white">
																{row.protocolSample || "—"}
															</p>
															<SourceCitation
																title="Where this appears in the trial protocol"
																variant="protocol"
																page={row.protocolEvidencePage}
																section={row.protocolEvidenceSection}
																quote={row.protocolEvidenceQuote}
															/>
														</div>
													</div>
													<div className="rounded-lg border border-gray-700/80 bg-gray-900/40 p-4">
														<p className="mb-3 text-xs font-semibold uppercase tracking-wider text-rose-300/90">
															Laboratory manual (checklist)
														</p>
														<div className="text-sm text-gray-300">
															<p className="mb-0.5 text-xs text-gray-500">
																Required sample type
															</p>
															<p className="text-white">
																{row.labSample || "—"}
															</p>
															<SourceCitation
																title="Where this appears in the laboratory manual"
																variant="lab"
																page={row.labEvidencePage}
																section={row.labEvidenceSection}
																quote={row.labEvidenceQuote}
															/>
														</div>
													</div>
												</div>
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

type JobApiResponse = {
	id: string;
	status: string;
	stageMessage?: string;
	error?: string;
	report?: ValidationReport;
};

export default function Index() {
	const protocolManualRef = useRef<HTMLInputElement>(null);
	const laboratoryManualRef = useRef<HTMLInputElement>(null);

	const [protocolManual, setProtocolManual] = useState<File | null>(null);
	const [laboratoryManual, setLaboratoryManual] = useState<File | null>(null);
	const [showSummary, setShowSummary] = useState(false);
	const [report, setReport] = useState<ValidationReport | null>(null);
	const [processing, setProcessing] = useState(false);
	const [stageMessage, setStageMessage] = useState<string | null>(null);
	const [jobError, setJobError] = useState<string | null>(null);

	const bothUploaded = protocolManual !== null && laboratoryManual !== null;

	const handleProtocolManualChange = (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		const file = e.target.files?.[0];
		setProtocolManual(file ?? null);
	};

	const handleLaboratoryManualChange = (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		const file = e.target.files?.[0];
		setLaboratoryManual(file ?? null);
	};

	const handleProcess = async () => {
		if (!bothUploaded || !protocolManual || !laboratoryManual) return;
		setJobError(null);
		setReport(null);
		setShowSummary(true);
		setProcessing(true);
		setStageMessage("Uploading PDFs…");

		const form = new FormData();
		form.set("protocol", protocolManual);
		form.set("lab", laboratoryManual);

		let jobId: string;
		let pollToken: string | undefined;
		try {
			const res = await fetch("/api/validate", {
				method: "POST",
				body: form,
				credentials: "same-origin",
			});
			const data = (await res.json()) as {
				jobId?: string;
				pollToken?: string;
				error?: string;
			};
			if (!res.ok) {
				setJobError(
					data.error ||
						`The upload was rejected (${res.status}). Try again or use smaller PDFs.`
				);
				setProcessing(false);
				setStageMessage(null);
				return;
			}
			if (!data.jobId) {
				setJobError("The server did not return a job id. Try again.");
				setProcessing(false);
				setStageMessage(null);
				return;
			}
			jobId = data.jobId;
			pollToken = data.pollToken;
		} catch {
			setJobError("Could not reach the server. Check your connection and try again.");
			setProcessing(false);
			setStageMessage(null);
			return;
		}

		const poll = async (): Promise<void> => {
			const headers: HeadersInit = {};
			if (pollToken)
				headers.Authorization = `Bearer ${pollToken}`;
			const res = await fetch(`/api/jobs/${jobId}`, {
				credentials: "same-origin",
				headers,
			});
			const data = (await res.json()) as JobApiResponse & { error?: string };
			if (!res.ok) {
				setJobError(
					data.error ||
						`Lost contact while checking status (${res.status}). Refresh and try again.`
				);
				setProcessing(false);
				setStageMessage(null);
				return;
			}
			if (data.stageMessage) setStageMessage(data.stageMessage);
			if (data.status === "done" && data.report) {
				setReport(data.report);
				setProcessing(false);
				setStageMessage(null);
				return;
			}
			if (data.status === "error") {
				setJobError(
					data.error ||
						"The comparison stopped with an error. Try again or use different PDFs."
				);
				setProcessing(false);
				setStageMessage(null);
				return;
			}
			setTimeout(() => void poll(), 1600);
		};

		void poll();
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0612] px-4">
			<div className="flex flex-col items-center gap-12">
				<header className="flex flex-col items-center gap-6 text-center">
					<h1 className="font-outfit text-3xl font-bold text-white md:text-4xl">
						Protocol Validator
					</h1>
					<p className="max-w-xl text-lg leading-relaxed text-gray-300">
						Compare your{" "}
						<strong className="font-semibold text-gray-200">
							trial protocol
						</strong>{" "}
						and{" "}
						<strong className="font-semibold text-gray-200">
							laboratory manual
						</strong>
						: we flag where required sample types match, differ, or only appear
						in the lab book—so you can fix gaps before startup.
					</p>
				</header>

				<div className="flex w-full flex-col items-center gap-8">
					<section className="w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
						<h2 className="mb-6 font-outfit text-xl font-semibold text-white">
							Upload PDFs
						</h2>
						<p className="mb-6 leading-relaxed text-gray-400">
							Add both documents as{" "}
							<strong className="text-gray-300">PDF</strong>. We read{" "}
							<strong className="text-gray-300">required sample types</strong>{" "}
							(specimens and matrices) from the lab manual and check them against
							the protocol. We do{" "}
							<strong className="text-gray-300">not</strong> compare visit
							schedules or logistics. Requirements that exist only in the
							protocol are omitted from the summary table.
						</p>

						<div className="space-y-4">
							<div>
								<label className="mb-2 block text-sm font-medium text-gray-300">
									Trial protocol
								</label>
								<input
									ref={protocolManualRef}
									type="file"
									accept=".pdf,application/pdf"
									onChange={handleProtocolManualChange}
									className="hidden"
								/>
								<button
									type="button"
									onClick={() => protocolManualRef.current?.click()}
									className="w-full rounded-xl border border-gray-600 bg-gray-800 px-6 py-3 text-left font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-700/80"
								>
									{protocolManual
										? protocolManual.name
										: "Choose trial protocol PDF"}
								</button>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-gray-300">
									Laboratory manual
								</label>
								<input
									ref={laboratoryManualRef}
									type="file"
									accept=".pdf,application/pdf"
									onChange={handleLaboratoryManualChange}
									className="hidden"
								/>
								<button
									type="button"
									onClick={() => laboratoryManualRef.current?.click()}
									className="w-full rounded-xl border border-gray-600 bg-gray-800 px-6 py-3 text-left font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-700/80"
								>
									{laboratoryManual
										? laboratoryManual.name
										: "Choose laboratory manual PDF"}
								</button>
							</div>

							<div className="pt-4">
								<button
									type="button"
									onClick={() => void handleProcess()}
									disabled={!bothUploaded || processing}
									className={`w-full rounded-xl px-6 py-3 font-semibold text-white shadow-md transition-all ${
										bothUploaded && !processing
											? "bg-gradient-to-r from-[#6f40ff] to-[#da016e] hover:opacity-90"
											: "cursor-not-allowed bg-gray-700 text-gray-500"
									}`}
								>
									{processing ? "Running comparison…" : "Run comparison"}
								</button>
							</div>
						</div>
					</section>

					{showSummary && (
						<section className="w-[64rem] max-w-full rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
							<h2 className="mb-2 font-outfit text-xl font-semibold text-white">
								{processing && !report && !jobError
									? "Working on your comparison"
									: report
										? "Results"
										: jobError
											? "We couldn’t finish"
											: "Results"}
							</h2>
							{processing && !jobError && (
								<div className="mb-6 space-y-3">
									<p className="text-sm font-medium text-gray-200">
										{stageMessage ?? "Starting…"}
									</p>
									<CyclingLoadingBar
										label={stageMessage ?? "Comparison in progress"}
									/>
								</div>
							)}
							{jobError && (
								<p className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm leading-relaxed text-rose-100">
									{jobError}
								</p>
							)}
							{report && (
								<>
									<p className="mb-4 text-sm leading-relaxed text-gray-400">
										<strong className="text-gray-300">
											{report.labClaimCount}
										</strong>{" "}
										sample row(s) from the lab manual.{" "}
										<strong className="text-gray-300">
											{report.protocolRequirementCount}
										</strong>{" "}
										have matching or possible protocol support (the rest are not
										found in the protocol excerpts we considered). Each row: fuzzy
										protocol pages, then a model check—open for quotes and notes.
										Confirm in the PDFs.
									</p>
									<SummaryTable
										rows={report.rows.filter(
											(r) => r.status !== "protocol_only"
										)}
									/>
								</>
							)}
						</section>
					)}
				</div>
			</div>
		</div>
	);
}
