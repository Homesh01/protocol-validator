/**
 * Structured JSON logs for Workers Observability / wrangler tail.
 * Avoid logging raw document text, full emails, or API keys.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_ERR_LEN = 1500;

export function truncateForLog(s: string, max = MAX_ERR_LEN): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}…[truncated]`;
}

export function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
	if (err instanceof Error) {
		return {
			name: err.name,
			message: truncateForLog(err.message),
			stack: err.stack ? truncateForLog(err.stack, 800) : undefined,
		};
	}
	return { message: truncateForLog(String(err)) };
}

/** e.g. user@company.com → domain company.com (no local part). */
export function emailDomainOnly(email: string): string {
	const at = email.lastIndexOf("@");
	if (at < 1 || at === email.length - 1) return "invalid";
	return email.slice(at + 1).toLowerCase();
}

function writeLine(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level,
		msg,
		service: "protocol-validator",
		...fields,
	});
	switch (level) {
		case "debug":
		case "info":
			console.log(line);
			break;
		case "warn":
			console.warn(line);
			break;
		case "error":
			console.error(line);
			break;
	}
}

export type JobLogger = {
	debug: (msg: string, extra?: Record<string, unknown>) => void;
	info: (msg: string, extra?: Record<string, unknown>) => void;
	warn: (msg: string, extra?: Record<string, unknown>) => void;
	error: (msg: string, extra?: Record<string, unknown>) => void;
	timeAsync: <T>(
		msg: string,
		fn: () => Promise<T>,
		extra?: Record<string, unknown>
	) => Promise<T>;
};

export function createJobLogger(jobId: string): JobLogger {
	const base = { jobId, scope: "validation_job" };
	return {
		debug(msg, extra) {
			writeLine("debug", msg, { ...base, ...extra });
		},
		info(msg, extra) {
			writeLine("info", msg, { ...base, ...extra });
		},
		warn(msg, extra) {
			writeLine("warn", msg, { ...base, ...extra });
		},
		error(msg, extra) {
			writeLine("error", msg, { ...base, ...extra });
		},
		async timeAsync(msg, fn, extra) {
			const t0 = Date.now();
			try {
				const result = await fn();
				writeLine("info", `${msg}_ok`, {
					...base,
					...extra,
					durationMs: Date.now() - t0,
				});
				return result;
			} catch (err) {
				writeLine("error", `${msg}_fail`, {
					...base,
					...extra,
					durationMs: Date.now() - t0,
					err: serializeError(err),
				});
				throw err;
			}
		},
	};
}

export function logValidationApi(
	level: LogLevel,
	msg: string,
	fields: Record<string, unknown> = {}
): void {
	writeLine(level, msg, { ...fields, scope: "validation_api" });
}
