/**
 * Email whitelist stored in KV as a JSON array.
 * Falls back to EMAIL_WHITELIST env var (comma-separated) if KV is empty.
 */

const WHITELIST_KV_KEY = "whitelist:emails";

export async function getWhitelistEmails(env: Env): Promise<string[]> {
	const fromKv = await env.AUTH_KV.get(WHITELIST_KV_KEY);
	if (fromKv) {
		try {
			const parsed = JSON.parse(fromKv) as unknown;
			if (Array.isArray(parsed)) {
				return parsed
					.filter((e): e is string => typeof e === "string")
					.map((e) => e.trim().toLowerCase())
					.filter(Boolean);
			}
		} catch {
			// Invalid JSON, fall through to env
		}
	}

	// Fallback to env var
	const fromEnv = env.EMAIL_WHITELIST || "";
	if (!fromEnv.trim()) return [];
	return fromEnv
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
}

export function isEmailInWhitelist(
	email: string,
	emails: string[]
): boolean {
	return emails.includes(email.toLowerCase());
}

export async function addToWhitelist(
	env: Env,
	email: string
): Promise<{ added: boolean; emails: string[] }> {
	const normalized = email.trim().toLowerCase();
	if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
		throw new Error("Invalid email");
	}

	const current = await getWhitelistEmails(env);
	if (current.includes(normalized)) {
		return { added: false, emails: current };
	}

	const updated = [...current, normalized].sort();
	await env.AUTH_KV.put(WHITELIST_KV_KEY, JSON.stringify(updated));
	return { added: true, emails: updated };
}

export async function removeFromWhitelist(
	env: Env,
	email: string
): Promise<{ removed: boolean; emails: string[] }> {
	const normalized = email.trim().toLowerCase();
	const current = await getWhitelistEmails(env);
	const updated = current.filter((e) => e !== normalized);

	if (updated.length === current.length) {
		return { removed: false, emails: current };
	}

	await env.AUTH_KV.put(WHITELIST_KV_KEY, JSON.stringify(updated));
	return { removed: true, emails: updated };
}
