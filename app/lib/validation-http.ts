import { checkAuthAndWhitelist } from "./auth";
import { emailDomainOnly, logValidationApi } from "./validation/log";
import { getWhitelistEmails } from "./whitelist";
import { runValidationPipeline } from "./validation/pipeline";
import {
	getJobState,
	labObjectKey,
	protocolObjectKey,
	putJobState,
	putPdf,
} from "./validation/job-storage";
import type { JobState } from "./validation/types";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

function extractPollToken(request: Request): string | null {
	const auth = request.headers.get("Authorization");
	if (auth?.startsWith("Bearer "))
		return auth.slice("Bearer ".length).trim() || null;
	const url = new URL(request.url);
	const q = url.searchParams.get("token");
	return q?.trim() || null;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function isPdf(file: File): boolean {
	const n = file.name.toLowerCase();
	return file.type === "application/pdf" || n.endsWith(".pdf");
}

export async function handleValidationApi(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/api/validate" && request.method === "POST") {
		const requestId = crypto.randomUUID();
		logValidationApi("info", "validate_post_received", {
			requestId,
			contentType: request.headers.get("Content-Type")?.slice(0, 80),
		});

		const whitelist = await getWhitelistEmails(env);
		const session = checkAuthAndWhitelist(request, whitelist);
		if (!session) {
			logValidationApi("warn", "validate_post_unauthorized", { requestId });
			return json({ error: "Unauthorized" }, 401);
		}

		if (!env.OPENAI_API_KEY?.trim()) {
			logValidationApi("error", "validate_post_missing_openai_key", {
				requestId,
				ownerDomain: emailDomainOnly(session.email),
			});
			return json(
				{ error: "Server missing OPENAI_API_KEY. Add it to secrets or .dev.vars." },
				503
			);
		}

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			logValidationApi("warn", "validate_post_bad_multipart", { requestId });
			return json({ error: "Invalid multipart body" }, 400);
		}

		const protocol = form.get("protocol");
		const lab = form.get("lab");
		if (!(protocol instanceof File) || !(lab instanceof File)) {
			logValidationApi("warn", "validate_post_bad_fields", { requestId });
			return json(
				{ error: 'Expected file fields "protocol" and "lab" (PDF).' },
				400
			);
		}
		if (!isPdf(protocol) || !isPdf(lab)) {
			logValidationApi("warn", "validate_post_non_pdf", {
				requestId,
				protocolType: protocol.type,
				labType: lab.type,
			});
			return json(
				{ error: "Only PDF uploads are supported in this version." },
				400
			);
		}
		if (protocol.size === 0 || lab.size === 0) {
			logValidationApi("warn", "validate_post_empty_file", { requestId });
			return json({ error: "Empty file" }, 400);
		}
		if (protocol.size > MAX_FILE_BYTES || lab.size > MAX_FILE_BYTES) {
			logValidationApi("warn", "validate_post_file_too_large", {
				requestId,
				protocolSize: protocol.size,
				labSize: lab.size,
				maxBytes: MAX_FILE_BYTES,
			});
			return json(
				{ error: `Each file must be under ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
				400
			);
		}

		const jobId = crypto.randomUUID();
		const pollToken = crypto.randomUUID();
		const now = Date.now();
		const ownerEmail = session.email;

		const protocolBuf = await protocol.arrayBuffer();
		const labBuf = await lab.arrayBuffer();

		await putPdf(
			env.VALIDATION_R2,
			protocolObjectKey(jobId),
			protocolBuf,
			"application/pdf"
		);
		await putPdf(
			env.VALIDATION_R2,
			labObjectKey(jobId),
			labBuf,
			"application/pdf"
		);

		const initial: JobState = {
			id: jobId,
			ownerEmail,
			status: "queued",
			stageMessage: "Queued…",
			createdAt: now,
			updatedAt: now,
			pollToken,
			protocolFileName: protocol.name,
			labFileName: lab.name,
		};
		await putJobState(env.VALIDATION_R2, initial);

		logValidationApi("info", "validate_job_accepted", {
			requestId,
			jobId,
			ownerDomain: emailDomainOnly(ownerEmail),
			protocolBytes: protocolBuf.byteLength,
			labBytes: labBuf.byteLength,
			protocolFileName: protocol.name.slice(0, 120),
			labFileName: lab.name.slice(0, 120),
		});

		ctx.waitUntil(runValidationPipeline(jobId, env));

		return json({ jobId, status: "queued", pollToken }, 202);
	}

	const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
	if (jobMatch && request.method === "GET") {
		const whitelist = await getWhitelistEmails(env);
		const jobId = jobMatch[1];
		const state = await getJobState(env.VALIDATION_R2, jobId);
		if (!state) {
			logValidationApi("warn", "job_get_not_found_or_forbidden", {
				jobIdPrefix: jobId.slice(0, 8),
				hasState: false,
			});
			return json({ error: "Not found" }, 404);
		}

		const pollTok = extractPollToken(request);
		const pollOk =
			Boolean(state.pollToken) &&
			Boolean(pollTok) &&
			pollTok === state.pollToken;

		if (!pollOk) {
			const session = checkAuthAndWhitelist(request, whitelist);
			if (!session || state.ownerEmail !== session.email) {
				logValidationApi("warn", "job_get_unauthorized", {
					jobIdPrefix: jobId.slice(0, 8),
				});
				return json({ error: "Unauthorized" }, 401);
			}
		}

		logValidationApi("debug", "job_get", {
			jobIdPrefix: jobId.slice(0, 8),
			status: state.status,
		});

		return json({
			id: state.id,
			status: state.status,
			stageMessage: state.stageMessage,
			error: state.error,
			report: state.report,
			createdAt: state.createdAt,
			updatedAt: state.updatedAt,
		});
	}

	return null;
}
