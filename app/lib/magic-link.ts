/**
 * Magic link request and verification handlers.
 * Sends email via Resend. Token stored in KV.
 */

import { Resend } from "resend";
import {
	generateMagicLinkToken,
	getMagicLinkKvKey,
	getMagicLinkExpiry,
	setSessionCookie,
} from "./auth";
import { getWhitelistEmails, isEmailInWhitelist } from "./whitelist";

export async function handleMagicLinkRequest(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let body: { email?: string };
	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ error: "Invalid JSON", authorized: false }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const email = typeof body.email === "string" ? body.email.trim() : "";
	if (!email) {
		return new Response(
			JSON.stringify({ error: "Email is required", authorized: false }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	// Basic email format check
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return new Response(
			JSON.stringify({ error: "Invalid email format", authorized: false }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const whitelistEmails = await getWhitelistEmails(env);
	if (!whitelistEmails.length) {
		return new Response(
			JSON.stringify({
				error: "Authentication is not configured. Contact the administrator.",
				authorized: false,
			}),
			{ status: 503, headers: { "Content-Type": "application/json" } }
		);
	}
	if (!isEmailInWhitelist(email, whitelistEmails)) {
		return new Response(
			JSON.stringify({
				error: "This email is not authorized to access the protocol validator.",
				authorized: false,
			}),
			{ status: 403, headers: { "Content-Type": "application/json" } }
		);
	}

	const token = generateMagicLinkToken();
	const kvKey = getMagicLinkKvKey(token);
	const expiresAt = getMagicLinkExpiry();
	await env.AUTH_KV.put(kvKey, JSON.stringify({ email, expiresAt }), {
		expirationTtl: Math.ceil(15 * 60), // 15 minutes in seconds
	});

	const appUrl = (env.APP_URL || "").replace(/\/$/, "");
	const magicLink = `${appUrl}/api/auth/verify?token=${token}`;

	const apiKey = env.RESEND_API_KEY || "";
	if (!apiKey) {
		return new Response(
			JSON.stringify({
				error: "Email service is not configured. Contact the administrator.",
				authorized: true,
			}),
			{ status: 503, headers: { "Content-Type": "application/json" } }
		);
	}

	const resend = new Resend(apiKey);
	const { error } = await resend.emails.send({
		from: "Protocol Validator <onboarding@resend.dev>",
		to: email,
		subject: "Your Protocol Validator login link",
		html: `
			<p>Click the link below to sign in to Protocol Validator. This link expires in 15 minutes.</p>
			<p><a href="${magicLink}">Sign in to Protocol Validator</a></p>
			<p>If you didn't request this email, you can safely ignore it.</p>
		`,
	});

	if (error) {
		const errMsg = typeof error === "object" && error !== null && "message" in error
			? String((error as { message?: unknown }).message)
			: String(error);
		console.error("[MagicLink] Resend failed:", errMsg, "Full error:", JSON.stringify(error));

		// Debug: include actual Resend error when admin secret is provided (for troubleshooting)
		const adminSecret = request.headers.get("X-Admin-Secret");
		const isDebug = adminSecret && env.ADMIN_SECRET && adminSecret === env.ADMIN_SECRET;
		const body: { error: string; authorized: boolean; debug?: string } = {
			error: "Failed to send magic link. Please try again later.",
			authorized: true,
		};
		if (isDebug) {
			body.debug = errMsg || JSON.stringify(error);
		}

		return new Response(JSON.stringify(body), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(
		JSON.stringify({
			message: "Check your email for the magic link.",
			authorized: true,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);
}

export async function handleMagicLinkVerify(
	request: Request,
	env: Env
): Promise<Response> {
	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	if (!token) {
		return Response.redirect(new URL("/login?error=missing_token", request.url).toString(), 302);
	}

	const kvKey = getMagicLinkKvKey(token);
	const stored = await env.AUTH_KV.get(kvKey);
	if (!stored) {
		return Response.redirect(new URL("/login?error=invalid_token", request.url).toString(), 302);
	}

	let data: { email: string; expiresAt: number };
	try {
		data = JSON.parse(stored);
	} catch {
		return Response.redirect(new URL("/login?error=invalid_token", request.url).toString(), 302);
	}

	if (Date.now() > data.expiresAt) {
		await env.AUTH_KV.delete(kvKey);
		return Response.redirect(new URL("/login?error=expired", request.url).toString(), 302);
	}

	await env.AUTH_KV.delete(kvKey);

	const redirect = new Response(null, { status: 302, headers: { Location: "/" } });
	return setSessionCookie(redirect, data.email, request);
}
