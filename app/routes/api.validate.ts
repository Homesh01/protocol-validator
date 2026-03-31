import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { handleValidationApi } from "~/lib/validation-http";

/**
 * Vite dev (`remix vite:dev`) only runs the Remix handler, not `server.ts`.
 * This route forwards validation uploads to the same logic as the Worker.
 */
export function loader() {
	return new Response("Method not allowed", { status: 405 });
}

export async function action({ request, context }: ActionFunctionArgs) {
	const { cloudflare } = context;
	const res = await handleValidationApi(
		request,
		cloudflare.env as Env,
		cloudflare.ctx
	);
	if (res) return res;
	return new Response("Not found", { status: 404 });
}

export default function ApiValidate() {
	return null;
}
