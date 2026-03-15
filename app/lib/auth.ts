/**
 * Magic link authentication with email whitelist.
 * Session cookie lasts 1 hour.
 */

const SESSION_COOKIE_NAME = "pv_session";
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour
const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const MAGIC_LINK_KV_PREFIX = "magic:";

export interface SessionData {
	email: string;
	expiresAt: number;
	issuedAt: number;
}

export function createSessionData(email: string): SessionData {
	return {
		email,
		expiresAt: Date.now() + SESSION_DURATION_MS,
		issuedAt: Date.now(),
	};
}

export function encodeSessionToken(data: SessionData): string {
	return btoa(JSON.stringify(data));
}

export function decodeSessionToken(token: string): SessionData | null {
	try {
		return JSON.parse(atob(token)) as SessionData;
	} catch {
		return null;
	}
}

export function isSessionValid(data: SessionData): boolean {
	return Date.now() <= data.expiresAt;
}

export function extractSessionToken(request: Request): string | null {
	const cookie = request.headers.get("Cookie");
	if (!cookie) return null;
	const match = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
	return match ? match[1] : null;
}

/** @deprecated Use isEmailInWhitelist from whitelist.ts with string[] */
export function isEmailWhitelisted(email: string, whitelist: string): boolean {
	if (!whitelist?.trim()) return false;
	const emails = whitelist.split(",").map((e) => e.trim().toLowerCase());
	return emails.includes(email.toLowerCase());
}

export function isEmailInWhitelist(email: string, emails: string[]): boolean {
	if (!emails.length) return false;
	return emails.includes(email.toLowerCase());
}

export function checkAuth(request: Request): SessionData | null {
	const token = extractSessionToken(request);
	if (!token) return null;
	const data = decodeSessionToken(token);
	if (!data || !isSessionValid(data)) return null;
	return data;
}

/**
 * Check auth AND verify the session email is still in the whitelist.
 * Use this for protected routes so removing someone from the whitelist
 * revokes access immediately.
 */
export function checkAuthAndWhitelist(
	request: Request,
	whitelistEmails: string[]
): SessionData | null {
	const session = checkAuth(request);
	if (!session) return null;
	if (!whitelistEmails.length) return null;
	if (!isEmailInWhitelist(session.email, whitelistEmails)) return null;
	return session;
}

export function setSessionCookie(
	response: Response,
	email: string,
	request?: Request
): Response {
	const data = createSessionData(email);
	const token = encodeSessionToken(data);
	const maxAge = Math.floor(SESSION_DURATION_MS / 1000);
	const isSecure =
		request && new URL(request.url).protocol === "https" ? "; Secure" : "";
	const newResponse = new Response(response.body, response);
	newResponse.headers.set(
		"Set-Cookie",
		`${SESSION_COOKIE_NAME}=${token}; HttpOnly${isSecure}; SameSite=Lax; Max-Age=${maxAge}; Path=/`
	);
	return newResponse;
}

export function clearSessionCookie(
	response: Response,
	request?: Request
): Response {
	const isSecure =
		request && new URL(request.url).protocol === "https" ? "; Secure" : "";
	const newResponse = new Response(response.body, response);
	newResponse.headers.set(
		"Set-Cookie",
		`${SESSION_COOKIE_NAME}=; HttpOnly${isSecure}; SameSite=Lax; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
	);
	return newResponse;
}

export function shouldProtectPath(pathname: string): boolean {
	const excluded = [
		"/login",
		"/logout",
		"/api/auth/",
		"/api/admin/",
		"/build/",
		"/assets/",
		"/favicon",
	];
	if (excluded.some((p) => pathname.startsWith(p))) return false;
	if (pathname.includes(".")) return false; // static files
	return true;
}

export function generateMagicLinkToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getMagicLinkKvKey(token: string): string {
	return `${MAGIC_LINK_KV_PREFIX}${token}`;
}

export function getMagicLinkExpiry(): number {
	return Date.now() + MAGIC_LINK_EXPIRY_MS;
}
