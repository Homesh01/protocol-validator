import { Fragment, useRef, useState } from "react";
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
	return [
		{ title: "Protocol Validator | Insynctrials" },
		{
			name: "description",
			content: "Validate and structure trial protocol requirements.",
		},
	];
};

type AnalysisRow = {
	analysis: string;
	sample: string;
	timepoints: string[];
	destination: string;
};

// Mock data – replace with parsed document output when processing is implemented
const MOCK_SUMMARY_DATA: AnalysisRow[] = [
	{
		analysis: "Fluorescence in situ hybridisation (FISH) and Gene expression profiling",
		sample: "Formalin-fixed and paraffin-embedded (FFPE) tissue specimens (blocks)",
		timepoints: [
			"Archival Tumour biopsy at first relapse (if available) or diagnostic biopsy. Send following patient registration",
			"Repeat tumour biopsy after 8 cycles if patient is PET positive and has given optional consent",
			"Repeat tumour biopsy at relapse if clinically indicated",
		],
		destination: "HMDS, Leeds",
	},
	{
		analysis: "Immunophenotyping",
		sample: "Peripheral blood in EDTA",
		timepoints: [
			"50ml within 3 days prior to start of cycle 1",
			"20ml within 3 days prior to start of cycle 2",
			"20ml within 3 days prior to start of cycle 4",
			"20ml within 3 days prior to start of cycle 6",
			"20ml within 3 days prior to start of cycle 8",
			"20ml at the 1 month post-treatment follow up visit",
		],
		destination: "Weatherall Institute of Molecular Medicine, Oxford",
	},
	{
		analysis: "TARC (CCL17) analysis",
		sample: "Peripheral blood in serum gel tube",
		timepoints: [
			"5ml within 3 days prior to start of cycle 1",
			"5ml within 3 days prior to start of cycle 2",
			"5ml within 3 days prior to start of cycle 4",
			"5ml within 3 days prior to start of cycle 6",
			"5ml within 3 days prior to start of cycle 8",
			"5ml at the 1 month post-treatment follow up visit",
		],
		destination: "Weatherall Institute of Molecular Medicine, Oxford",
	},
	{
		analysis: "Pharmacokinetic (PK) sampling",
		sample: "Plasma in EDTA tubes (K2EDTA)",
		timepoints: [
			"Pre-dose and 1, 2, 4, 6, 8, 24 hours post-dose at cycle 1 day 1",
			"Pre-dose at cycle 1 day 15 and cycle 2 day 1",
			"Pre-dose at cycle 4 day 1 and cycle 6 day 1",
			"Pre-dose at end of treatment visit",
		],
		destination: "Central Lab, Covance",
	},
	{
		analysis: "Circulating tumour DNA (ctDNA)",
		sample: "Peripheral blood in Streck Cell-Free DNA BCT tubes",
		timepoints: [
			"20ml at screening (within 28 days prior to cycle 1)",
			"20ml within 3 days prior to cycle 1 day 1",
			"20ml at cycle 8 day 1",
			"20ml at progression or end of treatment",
		],
		destination: "Guardant Health, Redwood City",
	},
	{
		analysis: "Hematology and clinical chemistry",
		sample: "Peripheral blood in EDTA (full blood count) and serum gel tube (chemistry)",
		timepoints: [
			"Within 7 days prior to cycle 1",
			"Day 1 of each cycle",
			"Day 15 of cycle 1",
			"At end of treatment and 30-day follow-up",
		],
		destination: "Local laboratory / Central Lab",
	},
	{
		analysis: "PD-L1 expression and tumour mutational burden",
		sample: "FFPE tumour tissue blocks or unstained slides",
		timepoints: [
			"Archival tissue at screening (if available within 12 months)",
			"Fresh biopsy at baseline if archival tissue not available",
			"Optional tumour biopsy at progression",
		],
		destination: "Foundation Medicine, Cambridge",
	},
	{
		analysis: "Anti-drug antibody (ADA) and neutralizing antibody (NAb)",
		sample: "Serum in plain tube (no gel)",
		timepoints: [
			"Pre-dose at cycle 1 day 1",
			"Pre-dose at cycle 3 day 1 and cycle 6 day 1",
			"At end of treatment and 90-day follow-up",
		],
		destination: "Q2 Solutions, Durham",
	},
];

function SummaryTable({ rows }: { rows: AnalysisRow[] }) {
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
					Expand all
				</button>
				<button
					type="button"
					onClick={collapseAll}
					disabled={expandedIndices.size === 0}
					className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-700/80 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Collapse all
				</button>
			</div>
			<div className="summary-table-scroll max-h-[40rem] overflow-x-auto overflow-y-auto rounded-xl border border-gray-700">
				<table className="w-full">
					<thead className="sticky top-0 z-10">
						<tr className="border-b border-gray-700 bg-gray-800">
							<th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
								Analysis
							</th>
							<th className="w-10 px-2 py-3" aria-label="Expand" />
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => {
							const isExpanded = expandedIndices.has(index);
							return (
								<Fragment key={index}>
									<tr
										onClick={() => toggleRow(index)}
									className="cursor-pointer border-b border-gray-700/50 transition-colors hover:bg-gray-800/50"
								>
									<td className="px-4 py-3 text-sm text-white">
										{row.analysis}
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
											colSpan={2}
											className="bg-gray-800/30 px-4 py-4"
										>
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
														Sample
													</p>
													<p className="text-sm text-gray-300">
														{row.sample}
													</p>
												</div>
												<div>
													<p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
														Destination
													</p>
													<p className="text-sm text-gray-300">
														{row.destination}
													</p>
												</div>
												<div className="sm:col-span-2">
													<p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
														Timepoints
													</p>
													<ul className="list-inside list-disc space-y-1 text-sm text-gray-300">
														{row.timepoints.map(
															(tp, i) => (
																<li key={i}>{tp}</li>
															)
														)}
													</ul>
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

export default function Index() {
	const protocolManualRef = useRef<HTMLInputElement>(null);
	const laboratoryManualRef = useRef<HTMLInputElement>(null);

	const [protocolManual, setProtocolManual] = useState<File | null>(null);
	const [laboratoryManual, setLaboratoryManual] = useState<File | null>(null);
	const [showSummary, setShowSummary] = useState(false);

	const bothUploaded = protocolManual !== null && laboratoryManual !== null;

	const handleProtocolManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		setProtocolManual(file ?? null);
	};

	const handleLaboratoryManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		setLaboratoryManual(file ?? null);
	};

	const handleProcess = () => {
		if (!bothUploaded) return;
		// TODO: Replace with actual document parsing; use mock data for now
		setShowSummary(true);
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0612] px-4">
			<div className="flex flex-col items-center gap-12">
				<header className="flex flex-col items-center gap-6 text-center">
					<h1 className="font-outfit text-3xl font-bold text-white md:text-4xl">
						Protocol Validator
					</h1>
					<p className="max-w-xl text-lg text-gray-300">
						Validate and structure trial protocol requirements for faster
						startup execution.
					</p>
				</header>

				<div className="flex w-full flex-col items-center gap-8">
					{/* Protocol Validation Upload - original width */}
					<section className="w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
						<h2 className="mb-6 font-outfit text-xl font-semibold text-white">
							Protocol Validation Upload
						</h2>
						<p className="mb-6 text-gray-400">
							Upload the Protocol Manual and Laboratory Manual to validate and
							process your trial protocol.
						</p>

						<div className="space-y-4">
							{/* Protocol Manual Upload */}
							<div>
								<label className="mb-2 block text-sm font-medium text-gray-300">
									Protocol Manual
								</label>
								<input
									ref={protocolManualRef}
									type="file"
									accept=".pdf,.doc,.docx"
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
										: "Upload Protocol Manual"}
								</button>
							</div>

							{/* Laboratory Manual Upload */}
							<div>
								<label className="mb-2 block text-sm font-medium text-gray-300">
									Laboratory Manual
								</label>
								<input
									ref={laboratoryManualRef}
									type="file"
									accept=".pdf,.doc,.docx"
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
										: "Upload Laboratory Manual"}
								</button>
							</div>

							{/* Process Button */}
							<div className="pt-4">
								<button
									type="button"
									onClick={handleProcess}
									disabled={!bothUploaded}
									className={`w-full rounded-xl px-6 py-3 font-semibold text-white shadow-md transition-all ${
										bothUploaded
											? "bg-gradient-to-r from-[#6f40ff] to-[#da016e] hover:opacity-90"
											: "cursor-not-allowed bg-gray-700 text-gray-500"
									}`}
								>
									Process
								</button>
							</div>
						</div>
					</section>

					{/* Summary Table - fixed width sized for expanded content */}
					{showSummary && (
						<section className="w-[64rem] max-w-full rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
							<h2 className="mb-6 font-outfit text-xl font-semibold text-white">
								Summary
							</h2>
							<p className="mb-4 text-sm text-gray-400">
								Click a row to expand and view full sample, timepoints, and
								destination details.
							</p>
							<SummaryTable rows={MOCK_SUMMARY_DATA} />
						</section>
					)}
				</div>
			</div>
		</div>
	);
}
