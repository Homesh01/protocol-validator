import type { JobLogger } from "./log";
import { truncateForLog } from "./log";

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * How long to wait before retrying after HTTP 429 (TPM/RPM). Uses Retry-After when set,
 * else parses OpenAI error text ("try again in 48.066s").
 */
export function parseOpenAiRateLimitWaitMs(res: Response, body: string): number {
	let ms = 50_000;
	const ra = res.headers.get("retry-after");
	if (ra) {
		const n = Number.parseFloat(ra.trim());
		if (Number.isFinite(n) && n >= 0) {
			ms = Math.min(180_000, Math.max(1_000, Math.ceil(n * 1000)));
		}
	} else {
		const m = body.match(/try again in\s+([\d.]+)\s*s/i);
		if (m) {
			const sec = Number.parseFloat(m[1]!);
			if (Number.isFinite(sec) && sec >= 0) {
				ms = Math.min(180_000, Math.max(1_000, Math.ceil(sec * 1000)));
			}
		}
	}
	// Extra buffer so rolling TPM (e.g. 30k/min) has actually reset
	return Math.min(200_000, ms + 8_000);
}

/**
 * Fetch OpenAI (or compatible) with retries on network errors and HTTP 429 rate limits.
 */
export async function openaiFetchResilient(
	url: string,
	init: RequestInit,
	log: JobLogger,
	op: string,
	opts: { maxAttempts?: number } = {}
): Promise<Response> {
	const maxAttempts = Math.max(1, opts.maxAttempts ?? 14);
	let lastErr: unknown;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const res = await fetch(url, init);
			if (res.status === 429) {
				const text = await res.text();
				if (attempt < maxAttempts - 1) {
					const waitMs = parseOpenAiRateLimitWaitMs(res, text);
					log.warn("openai_rate_limit_retry", {
						op,
						attempt: attempt + 1,
						maxAttempts,
						waitMs,
						preview: truncateForLog(text, 240),
					});
					await sleep(waitMs);
					continue;
				}
				return new Response(text, {
					status: 429,
					statusText: res.statusText,
					headers: res.headers,
				});
			}
			return res;
		} catch (e) {
			lastErr = e;
			const msg = e instanceof Error ? e.message : String(e);
			const retryable =
				/network|connection|fetch|timeout|lost|aborted|reset/i.test(msg) ||
				e instanceof TypeError;
			if (!retryable || attempt >= maxAttempts - 1) {
				throw e;
			}
			log.warn("openai_fetch_retry", {
				op,
				attempt: attempt + 1,
				msg: msg.slice(0, 200),
			});
			await sleep(2000 * (attempt + 1));
		}
	}
	throw lastErr;
}
