import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { handleValidationApi } from "~/lib/validation-http";

export async function loader({ request, context }: LoaderFunctionArgs) {
	const { cloudflare } = context;
	const res = await handleValidationApi(
		request,
		cloudflare.env as Env,
		cloudflare.ctx
	);
	if (res) return res;
	return new Response("Not found", { status: 404 });
}

export async function action(_args: ActionFunctionArgs) {
	return new Response("Method not allowed", { status: 405 });
}

export default function ApiJob() {
	return null;
}
