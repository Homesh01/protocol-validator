import type { JobLogger } from "./log";
import { truncateForLog } from "./log";
import { openaiFetchResilient } from "./openai-http";
import type { PdfPageText } from "./types";

type ResponsesPayload = Record<string, unknown> & {
	id?: string;
	status?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
	error?: { message?: string };
	incomplete_details?: { reason?: string };
};

const LARGE_PDF_BYTES = 350_000;
/** Below this for a large PDF, extraction is almost certainly broken. */
const HARD_FAIL_MAX_CHARS = 120;
/** gpt-4o PDF Responses hits TPM often; allow many 429 waits before failing. */
const PDF_FETCH_MAX_ATTEMPTS = 20;

function effectiveMaxOutputTokens(configMax: number, bytes: number): number {
	let m = Math.max(4_096, configMax);
	if (bytes >= 400_000) m = Math.max(m, 32_768);
	if (bytes >= 600_000) m = Math.max(m, 55_296);
	if (bytes >= 900_000) m = Math.max(m, 78_848);
	return Math.min(128_000, m);
}

/** Minimum plausible character count for a “large” PDF (avoids accepting 20-byte garbage). */
function minExpectedCharsForLargePdf(bytes: number): number {
	return Math.max(200, Math.min(3_500, Math.floor(bytes / 2_200)));
}

function truncatedByMaxOutput(data: ResponsesPayload): boolean {
	const d = data.incomplete_details;
	return (
		typeof d === "object" &&
		d !== null &&
		(d as { reason?: string }).reason === "max_output_tokens"
	);
}

function allowShortPdfOutput(env: Env): boolean {
	return (
		String(env.OPENAI_PDF_ALLOW_SHORT ?? "")
			.trim()
			.toLowerCase() === "true"
	);
}

/**
 * Model declined to transcribe (common when PDF pages are bitmap/scanned and the
 * model frames the task as "OCR" it won't perform).
 */
function looksLikeModelRefusal(text: string): boolean {
	const t = text.trim();
	if (t.length > 1_400) return false;
	const lower = t.toLowerCase();
	const needles = [
		"unable to",
		"can't extract",
		"cannot extract",
		"can not extract",
		"ocr software",
		"using ocr",
		"pdf images",
		"image-only",
		"scanned document",
		"share the text in another form",
		"not able to extract",
		"i'm unable",
		"i am unable",
		"do not have the ability",
	];
	return needles.some((n) => lower.includes(n)) && /extract|transcri|ocr|pdf|image|scan/i.test(t);
}

/** Upload PDF bytes; returns OpenAI `file-*` id (purpose `user_data` for Responses input). */
async function uploadPdfToOpenAI(
	env: Env,
	buffer: ArrayBuffer,
	filename: string,
	log: JobLogger,
	label: string
): Promise<string> {
	const safeName = filename.slice(0, 200) || "document.pdf";
	const form = new FormData();
	form.append("purpose", "user_data");
	form.append(
		"file",
		new Blob([buffer], { type: "application/pdf" }),
		safeName
	);

	const t0 = Date.now();
	const res = await openaiFetchResilient(
		"https://api.openai.com/v1/files",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			},
			body: form,
		},
		log,
		`${label}_files_upload`,
		{ maxAttempts: 14 }
	);
	const durationMs = Date.now() - t0;

	if (!res.ok) {
		const err = await res.text();
		log.error("openai_file_upload_error", {
			label,
			status: res.status,
			durationMs,
			bodyPreview: truncateForLog(err, 500),
		});
		throw new Error(`OpenAI file upload HTTP ${res.status}: ${err.slice(0, 400)}`);
	}

	const data = (await res.json()) as { id?: string };
	if (!data.id?.startsWith("file-")) {
		log.error("openai_file_upload_bad_response", { label, durationMs });
		throw new Error("OpenAI file upload returned no file id");
	}

	log.info("openai_file_upload_ok", {
		label,
		durationMs,
		fileIdPrefix: data.id.slice(0, 12),
		bytes: buffer.byteLength,
	});

	return data.id;
}

async function deleteOpenAIFile(
	env: Env,
	fileId: string,
	log: JobLogger,
	label: string
): Promise<void> {
	try {
		const res = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
		});
		if (!res.ok) {
			const t = await res.text();
			log.warn("openai_file_delete_http", {
				label,
				status: res.status,
				preview: t.slice(0, 120),
			});
		}
	} catch (e) {
		log.warn("openai_file_delete_failed", {
			label,
			err: e instanceof Error ? e.message : String(e),
		});
	}
}

async function retrieveResponse(
	env: Env,
	responseId: string,
	log: JobLogger,
	label: string
): Promise<ResponsesPayload> {
	const res = await openaiFetchResilient(
		`https://api.openai.com/v1/responses/${responseId}`,
		{
			method: "GET",
			headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
		},
		log,
		`${label}_responses_get`,
		{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
	);
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`GET /v1/responses/${responseId.slice(0, 12)}… ${res.status}: ${t.slice(0, 400)}`);
	}
	return (await res.json()) as ResponsesPayload;
}

/**
 * Long PDF jobs must not use a single blocking fetch (connection drops ~minutes).
 * Background mode returns quickly; we poll with short GETs.
 */
async function pollResponsesUntilDone(
	env: Env,
	responseId: string,
	log: JobLogger,
	label: string,
	maxPollMs: number
): Promise<ResponsesPayload> {
	const t0 = Date.now();
	let lastInfoLog = 0;

	while (Date.now() - t0 < maxPollMs) {
		const data = await retrieveResponse(env, responseId, log, label);
		const status = data.status ?? "";

		const now = Date.now();
		if (now - lastInfoLog > 30_000) {
			log.info("openai_responses_poll", {
				label,
				status,
				elapsedMs: now - t0,
				responseIdPrefix: responseId.slice(0, 12),
			});
			lastInfoLog = now;
		} else {
			log.debug("openai_responses_poll", { label, status });
		}

		if (status === "queued" || status === "in_progress") {
			await new Promise((r) => setTimeout(r, 3000));
			continue;
		}

		if (status === "failed" || status === "cancelled" || status === "canceled") {
			const msg =
				data.error &&
				typeof data.error === "object" &&
				"message" in data.error
					? String((data.error as { message: string }).message)
					: JSON.stringify(data.error ?? data).slice(0, 600);
			throw new Error(`OpenAI response ${status}: ${msg}`);
		}

		return data;
	}

	throw new Error(
		`OpenAI response polling timed out after ${maxPollMs}ms (response ${responseId.slice(0, 12)}…)`
	);
}

async function awaitResponseComplete(
	env: Env,
	data: ResponsesPayload,
	log: JobLogger,
	label: string
): Promise<ResponsesPayload> {
	const st = data.status ?? "";
	if (data.id && (st === "queued" || st === "in_progress")) {
		log.info("openai_responses_await_completion", {
			label,
			responseIdPrefix: data.id.slice(0, 12),
			status: st,
		});
		return pollResponsesUntilDone(
			env,
			data.id,
			log,
			label,
			parsePollMaxMs(env)
		);
	}
	return data;
}

function parsePagesFromModelText(raw: string): PdfPageText[] {
	const re = /---\s*Page\s+(\d+)\s*---/gi;
	const matches = [...raw.matchAll(re)];
	if (matches.length === 0) {
		const t = raw.trim();
		return t ? [{ page: 1, text: t }] : [{ page: 1, text: "" }];
	}

	const pages: PdfPageText[] = [];
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i]!;
		const pageNum = Number(m[1]);
		const start = m.index! + m[0].length;
		const end = i + 1 < matches.length ? matches[i + 1]!.index! : raw.length;
		const text = raw.slice(start, end).trim();
		pages.push({ page: pageNum, text });
	}

	const firstIdx = matches[0]!.index!;
	if (firstIdx > 0) {
		const preamble = raw.slice(0, firstIdx).trim();
		if (preamble) {
			if (pages[0]?.page === 1) {
				pages[0] = {
					page: 1,
					text: `${preamble}\n${pages[0].text}`.trim(),
				};
			} else {
				pages.unshift({ page: 1, text: preamble });
			}
		}
	}

	const filtered = pages.filter((p) => p.text.length > 0);
	return filtered.length > 0 ? filtered : [{ page: 1, text: raw.trim() }];
}

/**
 * Collect assistant text from Responses payloads; shapes vary by API version
 * (nested message/content, top-level output_text, etc.).
 */
function getResponsesOutputText(data: Record<string, unknown>): string {
	const otRaw = data.output_text;
	if (typeof otRaw === "string" && otRaw.trim()) return otRaw.trim();
	if (Array.isArray(otRaw)) {
		const joined = otRaw
			.filter((x): x is string => typeof x === "string")
			.join("\n")
			.trim();
		if (joined) return joined;
	}
	const chunks: string[] = [];
	function walk(node: unknown, depth: number): void {
		if (depth > 28) return;
		if (node === null || node === undefined) return;
		if (Array.isArray(node)) {
			for (const x of node) walk(x, depth + 1);
			return;
		}
		if (typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		const typ = o.type;
		if (
			(typ === "output_text" || typ === "text") &&
			typeof o.text === "string" &&
			o.text.length > 0
		) {
			chunks.push(o.text);
		}
		for (const v of Object.values(o)) walk(v, depth + 1);
	}
	if (Array.isArray(data.output)) walk(data.output, 0);
	else if (data.output) walk(data.output, 0);
	return chunks.join("\n").trim();
}

function parsePollMaxMs(env: Env): number {
	const raw = env.OPENAI_PDF_POLL_MAX_MS
		? Number.parseInt(String(env.OPENAI_PDF_POLL_MAX_MS), 10)
		: NaN;
	if (Number.isFinite(raw) && raw >= 60_000) return Math.min(raw, 3_600_000);
	return 25 * 60 * 1000;
}

/**
 * PDF text via OpenAI: Files upload + Responses API.
 * Uses **background** Responses + **polling** so one connection is not held open for many minutes
 * (avoids "Network connection lost" on long PDFs). PDFs ≥ LARGE_PDF_BYTES always use background+store
 * even if OPENAI_PDF_RESPONSES_BACKGROUND=false, so retries do not block on a single long POST.
 */
export async function extractPdfTextWithOpenAI(
	env: Env,
	buffer: ArrayBuffer,
	filename: string,
	log: JobLogger,
	label: string
): Promise<{ totalPages: number; pages: PdfPageText[] }> {
	const model = env.OPENAI_PDF_MODEL?.trim() || "gpt-4o";
	const maxOutParsed = env.OPENAI_PDF_MAX_OUTPUT_TOKENS
		? Number.parseInt(String(env.OPENAI_PDF_MAX_OUTPUT_TOKENS), 10)
		: NaN;
	const configuredMax = Math.min(
		Math.max(
			4_096,
			Number.isFinite(maxOutParsed) ? maxOutParsed : 16_384
		),
		128_000
	);
	const effectiveMax = effectiveMaxOutputTokens(
		configuredMax,
		buffer.byteLength
	);

	const useBackground =
		String(env.OPENAI_PDF_RESPONSES_BACKGROUND ?? "true")
			.trim()
			.toLowerCase() !== "false";

	const preferBackground =
		useBackground || buffer.byteLength >= LARGE_PDF_BYTES;

	const instruction = `Transcribe all readable text from this PDF in natural reading order. Pages may be rendered visually (including scanned or image-based pages); read the content and output it as plain text.

Rules:
- Output ONLY the document text (no preamble, apology, or advice about other tools).
- Do not refuse the task or say you cannot extract text from PDFs or images.
- Before the text of each page, insert exactly one line: --- Page N --- where N is the PDF page number starting at 1.
- Preserve paragraphs and line breaks where reasonable.
- If a page has no legible text, still include the marker with a blank line after it.`;

	const aggressiveInstruction = `${instruction}

Critical: This file may be long. Do not summarize, skip pages, or refuse. Transcribe the full document. If output limits apply, use as many tokens as allowed starting from page 1 without omitting sections.`;

	const visionTranscribeInstruction = `You are helping with regulatory document processing. The file is a PDF whose pages may be bitmap or scan images.

Task: read every page and transcribe ALL legible text (headings, tables, body, footnotes) in reading order.

Strict rules:
- Your reply must be ONLY the transcribed document text.
- Do not apologize, refuse, suggest external OCR products, or explain limitations.
- Before each page, output exactly: --- Page N --- (N = 1, 2, 3, …).
- Include table cell text in reading order; preserve line breaks where helpful.`;

	let fileId: string | null = null;
	const t0 = Date.now();

	try {
		fileId = await uploadPdfToOpenAI(env, buffer, filename, log, label);

		const buildPayload = (maxTok: number, instruct: string) => ({
			model,
			max_output_tokens: maxTok,
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: instruct },
						{ type: "input_file", file_id: fileId! },
					],
				},
			],
		});

		const inputPayload = buildPayload(effectiveMax, instruction);

		const wrapBg = (p: ReturnType<typeof buildPayload>) =>
			preferBackground
				? { ...p, background: true as const, store: true as const }
				: p;

		log.debug("openai_pdf_extract_responses_request", {
			label,
			model,
			configuredMax,
			effectiveMax,
			bytes: buffer.byteLength,
			background: preferBackground,
			backgroundEnv: useBackground,
		});

		let res = await openaiFetchResilient(
			"https://api.openai.com/v1/responses",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.OPENAI_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(wrapBg(inputPayload)),
			},
			log,
			`${label}_responses_create`,
			{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
		);

		if (!res.ok && preferBackground) {
			const errText = await res.text();
			const retrySync =
				res.status === 400 &&
				/background|store|not\s+support|unknown/i.test(errText);
			if (retrySync) {
				if (buffer.byteLength >= LARGE_PDF_BYTES) {
					log.warn("openai_responses_sync_fallback_large_file", {
						label,
						bytes: buffer.byteLength,
					});
				}
				log.warn("openai_responses_sync_fallback", {
					label,
					preview: truncateForLog(errText, 240),
				});
				res = await openaiFetchResilient(
					"https://api.openai.com/v1/responses",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.OPENAI_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(inputPayload),
					},
					log,
					`${label}_responses_create_sync`,
					{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
				);
			} else {
				log.error("openai_pdf_extract_http_error", {
					label,
					status: res.status,
					durationMs: Date.now() - t0,
					bodyPreview: truncateForLog(errText, 600),
				});
				throw new Error(
					`OpenAI PDF extract HTTP ${res.status}: ${errText.slice(0, 500)}`
				);
			}
		} else if (!res.ok) {
			const errText = await res.text();
			log.error("openai_pdf_extract_http_error", {
				label,
				status: res.status,
				durationMs: Date.now() - t0,
				bodyPreview: truncateForLog(errText, 600),
			});
			throw new Error(
				`OpenAI PDF extract HTTP ${res.status}: ${errText.slice(0, 500)}`
			);
		}

		let data = (await res.json()) as ResponsesPayload;
		data = await awaitResponseComplete(env, data, log, label);
		let rawText = getResponsesOutputText(data).trim();

		let visionTranscribeDone = false;
		const tryVisionTranscribe = async (): Promise<void> => {
			if (visionTranscribeDone || !fileId) return;
			visionTranscribeDone = true;
			log.warn("openai_pdf_extract_vision_retry", {
				label,
				refusal: looksLikeModelRefusal(rawText),
				outputChars: rawText.length,
			});
			const visionPayload = buildPayload(128_000, visionTranscribeInstruction);
			const resV = await openaiFetchResilient(
				"https://api.openai.com/v1/responses",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.OPENAI_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(wrapBg(visionPayload)),
				},
				log,
				`${label}_responses_vision_transcribe`,
				{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
			);
			if (!resV.ok) return;
			let dV = (await resV.json()) as ResponsesPayload;
			dV = await awaitResponseComplete(env, dV, log, label);
			const tV = getResponsesOutputText(dV).trim();
			const wasRefusal = looksLikeModelRefusal(rawText);
			if (
				!looksLikeModelRefusal(tV) &&
				(tV.length > rawText.length || wasRefusal)
			) {
				log.info("openai_pdf_extract_vision_retry_improved", {
					label,
					beforeChars: rawText.length,
					afterChars: tV.length,
				});
				rawText = tV;
				data = dV;
			}
		};

		if (truncatedByMaxOutput(data)) {
			log.warn("openai_pdf_extract_incomplete_max_tokens", {
				label,
				outputChars: rawText.length,
			});
			const bumpPayload = buildPayload(128_000, instruction);
			const resBump = await openaiFetchResilient(
				"https://api.openai.com/v1/responses",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.OPENAI_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(wrapBg(bumpPayload)),
				},
				log,
				`${label}_responses_retry_128k`,
				{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
			);
			if (resBump.ok) {
				let dBump = (await resBump.json()) as ResponsesPayload;
				dBump = await awaitResponseComplete(env, dBump, log, label);
				const tBump = getResponsesOutputText(dBump).trim();
				if (tBump.length > rawText.length) {
					log.info("openai_pdf_extract_retry_128k_improved", {
						label,
						beforeChars: rawText.length,
						afterChars: tBump.length,
					});
					data = dBump;
					rawText = tBump;
				}
			}
		}

		const minExpected =
			buffer.byteLength >= LARGE_PDF_BYTES
				? minExpectedCharsForLargePdf(buffer.byteLength)
				: 0;

		if (
			rawText.length < minExpected &&
			buffer.byteLength >= LARGE_PDF_BYTES
		) {
			log.warn("openai_pdf_extract_suspiciously_short", {
				label,
				outputChars: rawText.length,
				minExpected,
				inputBytes: buffer.byteLength,
				incomplete: truncatedByMaxOutput(data),
				outputPreview: truncateForLog(rawText, 160),
			});

			if (preferBackground) {
				const resSync = await openaiFetchResilient(
					"https://api.openai.com/v1/responses",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.OPENAI_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(wrapBg(inputPayload)),
					},
					log,
					`${label}_responses_bg_retry_short`,
					{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
				);
				if (resSync.ok) {
					let d2 = (await resSync.json()) as ResponsesPayload;
					d2 = await awaitResponseComplete(env, d2, log, label);
					const t2 = getResponsesOutputText(d2).trim();
					if (t2.length > rawText.length) {
						log.info("openai_pdf_extract_sync_retry_improved", {
							label,
							beforeChars: rawText.length,
							afterChars: t2.length,
						});
						rawText = t2;
						data = d2;
					}
				}
			}

			if (rawText.length < minExpected) {
				const hiPayload = buildPayload(128_000, aggressiveInstruction);
				const resHi = await openaiFetchResilient(
					"https://api.openai.com/v1/responses",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.OPENAI_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(wrapBg(hiPayload)),
					},
					log,
					`${label}_responses_128k_aggressive`,
					{ maxAttempts: PDF_FETCH_MAX_ATTEMPTS }
				);
				if (resHi.ok) {
					let d3 = (await resHi.json()) as ResponsesPayload;
					d3 = await awaitResponseComplete(env, d3, log, label);
					const t3 = getResponsesOutputText(d3).trim();
					if (t3.length > rawText.length) {
						log.info("openai_pdf_extract_aggressive_improved", {
							label,
							beforeChars: rawText.length,
							afterChars: t3.length,
						});
						rawText = t3;
						data = d3;
					}
				}
			}

			if (
				looksLikeModelRefusal(rawText) ||
				(rawText.length < minExpected && rawText.length < 450)
			) {
				await tryVisionTranscribe();
			}
		}

		if (looksLikeModelRefusal(rawText)) {
			await tryVisionTranscribe();
		}

		const durationMs = Date.now() - t0;

		if (looksLikeModelRefusal(rawText)) {
			log.error("openai_pdf_extract_model_refusal", {
				label,
				outputChars: rawText.length,
				inputBytes: buffer.byteLength,
				preview: truncateForLog(rawText, 280),
			});
			throw new Error(
				"This PDF looks like scanned or image-based pages: the model refused to transcribe it (not a token-limit issue). Fix: export a text-based PDF from Word/InDesign, run a proper OCR pass locally, or try another OPENAI_PDF_MODEL. OPENAI_PDF_ALLOW_SHORT does not help when the output is a refusal message."
			);
		}

		if (
			buffer.byteLength >= LARGE_PDF_BYTES &&
			rawText.length > 0 &&
			rawText.length < HARD_FAIL_MAX_CHARS
		) {
			log.error("openai_pdf_extract_too_short_for_size", {
				label,
				outputChars: rawText.length,
				inputBytes: buffer.byteLength,
				preview: truncateForLog(rawText, 200),
			});
			throw new Error(
				"PDF text extraction returned almost no text for a large file (often image-only/scanned PDFs or a hard refusal). Try a text-based PDF, another OPENAI_PDF_MODEL, or set OPENAI_PDF_ALLOW_SHORT=true to continue with low-quality text."
			);
		}

		if (
			buffer.byteLength >= LARGE_PDF_BYTES &&
			rawText.length > 0 &&
			rawText.length < minExpected
		) {
			if (allowShortPdfOutput(env)) {
				log.warn("openai_pdf_extract_allow_short", {
					label,
					outputChars: rawText.length,
					minExpected,
					inputBytes: buffer.byteLength,
				});
			} else {
				log.error("openai_pdf_extract_below_expected", {
					label,
					outputChars: rawText.length,
					minExpected,
					inputBytes: buffer.byteLength,
					preview: truncateForLog(rawText, 200),
				});
				throw new Error(
					`PDF text looks too short for this file size (${rawText.length} chars; expected about ${minExpected}+). If the preview is a refusal to extract, the PDF is likely image-only—use a text-based export or OCR. Otherwise try OPENAI_PDF_MODEL, OPENAI_PDF_MAX_OUTPUT_TOKENS, or OPENAI_PDF_ALLOW_SHORT=true.`
				);
			}
		}

		if (!rawText) {
			log.error("openai_pdf_extract_empty", { label, durationMs, status: data.status });
			throw new Error("OpenAI returned no text for PDF");
		}

		log.info("openai_pdf_extract_ok", {
			label,
			durationMs,
			model,
			outputChars: rawText.length,
			finalStatus: data.status,
			inputTokens: data.usage?.input_tokens,
			outputTokens: data.usage?.output_tokens,
		});

		const pages = parsePagesFromModelText(rawText);
		const totalPages =
			pages.length > 0 ? Math.max(...pages.map((p) => p.page)) : 1;

		log.debug("openai_pdf_pages_parsed", {
			label,
			segmentCount: pages.length,
			highestPageNumber: totalPages,
		});

		return { totalPages, pages };
	} finally {
		if (fileId) {
			await deleteOpenAIFile(env, fileId, log, label);
		}
	}
}
