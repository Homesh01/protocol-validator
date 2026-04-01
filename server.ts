import { createRequestHandler, type ServerBuild } from "@remix-run/cloudflare";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore This file won’t exist if it hasn’t yet been built
import * as build from "./build/server"; // eslint-disable-line import/no-unresolved
import { getLoadContext } from "./load-context";
import { checkAuthAndWhitelist, shouldProtectPath } from "./app/lib/auth";
import { getWhitelistEmails } from "./app/lib/whitelist";
import {
	handleMagicLinkRequest,
	handleMagicLinkVerify,
} from "./app/lib/magic-link";
import { handleAdminWhitelist } from "./app/lib/admin-whitelist";
import { clearSessionCookie } from "./app/lib/auth";
import { handleValidationApi } from "./app/lib/validation-http";
import { runValidationPipeline } from "./app/lib/validation/pipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleRemixRequest = createRequestHandler(build as any as ServerBuild);

export default {
	async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
		for (const message of batch.messages) {
			const body = message.body as { jobId?: unknown };
			const jobId = typeof body?.jobId === "string" ? body.jobId : "";
			if (!jobId) {
				message.ack();
				continue;
			}
			try {
				await runValidationPipeline(jobId, env);
				message.ack();
			} catch (error) {
				console.error(
					JSON.stringify({
						ts: new Date().toISOString(),
						level: "error",
						msg: "validation_queue_message_failed",
						service: "protocol-validator",
						jobId,
						err:
							error instanceof Error
								? { name: error.name, message: error.message.slice(0, 500) }
								: { message: String(error).slice(0, 500) },
					})
				);
				message.retry();
			}
		}
	},
	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			const pathname = url.pathname;

			// Quiet 404 for common scanner paths (avoids noisy Remix/stream errors)
			if (
				pathname.startsWith("/.svn/") ||
				pathname.startsWith("/.git/") ||
				pathname === "/.env" ||
				pathname === "/.DS_Store"
			) {
				return new Response(null, { status: 404 });
			}

			if (pathname === "/api/auth/magic-link") {
				return handleMagicLinkRequest(request, env);
			}
			if (pathname === "/api/auth/verify") {
				return handleMagicLinkVerify(request, env);
			}
			if (pathname === "/api/admin/whitelist") {
				return handleAdminWhitelist(request, env);
			}
			const validationResponse = await handleValidationApi(request, env, ctx);
			if (validationResponse) {
				return validationResponse;
			}
			if (pathname === "/logout") {
				const redirect = Response.redirect(
					new URL("/login", request.url).toString(),
					302
				);
				return clearSessionCookie(redirect, request);
			}

			if (shouldProtectPath(pathname)) {
				const whitelistEmails = await getWhitelistEmails(env);
				const session = checkAuthAndWhitelist(request, whitelistEmails);
				if (!session) {
					const redirect = Response.redirect(
						new URL("/login", request.url).toString(),
						302
					);
					return clearSessionCookie(redirect, request);
				}
			}

			const loadContext = getLoadContext({
				request,
				context: {
					cloudflare: {
						// This object matches the return value from Wrangler's
						// `getPlatformProxy` used during development via Remix's
						// `cloudflareDevProxyVitePlugin`:
						// https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy
						cf: request.cf,
						ctx: {
							waitUntil: ctx.waitUntil.bind(ctx),
							passThroughOnException: ctx.passThroughOnException.bind(ctx),
							props: {},
						},
						caches,
						env,
					},
				},
			});
			return await handleRemixRequest(request, loadContext);
		} catch (error) {
			const path = new URL(request.url).pathname;
			console.error(
				JSON.stringify({
					ts: new Date().toISOString(),
					level: "error",
					msg: "worker_fetch_unhandled",
					service: "protocol-validator",
					path,
					method: request.method,
					err:
						error instanceof Error
							? {
									name: error.name,
									message: error.message.slice(0, 800),
									stack: error.stack?.slice(0, 1200),
								}
							: { message: String(error).slice(0, 800) },
				})
			);
			return new Response("An unexpected error occurred", { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
