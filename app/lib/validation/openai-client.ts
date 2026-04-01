import type { JobLogger } from "./log";
import { serializeError, truncateForLog } from "./log";
import { openaiFetchResilient } from "./openai-http";

function parseJsonFromModelContent(raw: string): unknown {
	const t = raw.trim();
	const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/);
	const s = fence ? fence[1].trim() : t;
	return JSON.parse(s) as unknown;
}

export type OpenAiCallMeta = { op: string; chunkIndex?: number };

export async function openaiChatJson<T>(
	env: Env,
	system: string,
	user: string,
	log: JobLogger,
	meta: OpenAiCallMeta
): Promise<T> {
	const model = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
	const t0 = Date.now();
	log.debug("openai_request", {
		op: meta.op,
		model,
		systemChars: system.length,
		userChars: user.length,
		chunkIndex: meta.chunkIndex,
	});

	const res = await openaiFetchResilient(
		"https://api.openai.com/v1/chat/completions",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				response_format: { type: "json_object" },
				temperature: 0.15,
			}),
		},
		log,
		meta.op,
		{ maxAttempts: 14 }
	);

	const durationMs = Date.now() - t0;

	if (!res.ok) {
		const err = await res.text();
		log.error("openai_http_error", {
			op: meta.op,
			status: res.status,
			durationMs,
			bodyPreview: truncateForLog(err, 500),
			chunkIndex: meta.chunkIndex,
		});
		throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 800)}`);
	}

	const data = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	};
	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		log.error("openai_empty_content", {
			op: meta.op,
			durationMs,
			chunkIndex: meta.chunkIndex,
		});
		throw new Error("OpenAI returned empty content");
	}

	log.info("openai_response", {
		op: meta.op,
		durationMs,
		model,
		contentChars: content.length,
		chunkIndex: meta.chunkIndex,
		promptTokens: data.usage?.prompt_tokens,
		completionTokens: data.usage?.completion_tokens,
		totalTokens: data.usage?.total_tokens,
	});

	try {
		return parseJsonFromModelContent(content) as T;
	} catch (e) {
		log.error("openai_json_parse_error", {
			op: meta.op,
			contentLength: content.length,
			parseErr: serializeError(e),
			chunkIndex: meta.chunkIndex,
		});
		throw new Error(`Invalid JSON from model (${meta.op})`);
	}
}
