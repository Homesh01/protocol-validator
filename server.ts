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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleRemixRequest = createRequestHandler(build as any as ServerBuild);

export default {
	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url);
			const pathname = url.pathname;

			if (pathname === "/api/auth/magic-link") {
				return handleMagicLinkRequest(request, env);
			}
			if (pathname === "/api/auth/verify") {
				return handleMagicLinkVerify(request, env);
			}
			if (pathname === "/api/admin/whitelist") {
				return handleAdminWhitelist(request, env);
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
			console.log(error);
			return new Response("An unexpected error occurred", { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
