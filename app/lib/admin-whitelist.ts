/**
 * Admin API for managing the email whitelist.
 * Protected by ADMIN_SECRET header: X-Admin-Secret: <ADMIN_SECRET>
 */

import {
	getWhitelistEmails,
	addToWhitelist,
	removeFromWhitelist,
} from "./whitelist";

const ADMIN_HEADER = "x-admin-secret";

function requireAdmin(request: Request, env: Env): Response | null {
	const secret = env.ADMIN_SECRET || "";
	if (!secret.trim()) {
		return new Response(
			JSON.stringify({ error: "Admin API not configured" }),
			{ status: 503, headers: { "Content-Type": "application/json" } }
		);
	}
	const provided = request.headers.get(ADMIN_HEADER) || "";
	if (provided !== secret) {
		return new Response(
			JSON.stringify({ error: "Unauthorized" }),
			{ status: 401, headers: { "Content-Type": "application/json" } }
		);
	}
	return null;
}

export async function handleAdminWhitelist(
	request: Request,
	env: Env
): Promise<Response> {
	const authError = requireAdmin(request, env);
	if (authError) return authError;

	const json = (body: unknown) =>
		new Response(JSON.stringify(body), {
			headers: { "Content-Type": "application/json" },
		});

	switch (request.method) {
		case "GET": {
			const emails = await getWhitelistEmails(env);
			return json({ emails });
		}

		case "POST": {
			let body: { email?: string };
			try {
				body = await request.json();
			} catch {
				return json({ error: "Invalid JSON" });
			}
			const email = typeof body.email === "string" ? body.email : "";
			if (!email.trim()) {
				return new Response(JSON.stringify({ error: "email is required" }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
			try {
				const result = await addToWhitelist(env, email);
				return json(result);
			} catch (e) {
				return new Response(
					JSON.stringify({
						error: e instanceof Error ? e.message : "Invalid email",
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } }
				);
			}
		}

		case "DELETE": {
			let body: { email?: string };
			try {
				body = await request.json();
			} catch {
				return json({ error: "Invalid JSON" });
			}
			const email = typeof body.email === "string" ? body.email : "";
			if (!email.trim()) {
				return new Response(JSON.stringify({ error: "email is required" }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
			const result = await removeFromWhitelist(env, email);
			return json(result);
		}

		default:
			return new Response(JSON.stringify({ error: "Method not allowed" }), {
				status: 405,
				headers: { "Content-Type": "application/json" },
			});
	}
}
