import { useState } from "react";
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
	return [
		{ title: "Sign in | Protocol Validator" },
		{ name: "description", content: "Sign in with your email to access Protocol Validator." },
	];
};

const ERROR_MESSAGES: Record<string, string> = {
	missing_token: "Please request a new magic link.",
	invalid_token: "This link is invalid or has already been used.",
	expired: "This link has expired. Please request a new one.",
};

export default function Login() {
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [message, setMessage] = useState("");

	// Get error from URL on mount
	const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
	const urlError = urlParams?.get("error") || "";

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim()) return;

		setStatus("loading");
		setMessage("");

		try {
			const res = await fetch("/api/auth/magic-link", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: email.trim() }),
			});

			const data = await res.json();

			if (res.ok) {
				setStatus("success");
				setMessage(data.message || "Check your email for the magic link.");
			} else {
				setStatus("error");
				setMessage(data.error || "Something went wrong.");
			}
		} catch {
			setStatus("error");
			setMessage("Failed to send magic link. Please try again.");
		}
	};

	const displayError = urlError && ERROR_MESSAGES[urlError];

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0612] px-4">
			<div className="w-full max-w-md">
				<header className="mb-10 text-center">
					<h1 className="font-outfit text-3xl font-bold text-white">
						Protocol Validator
					</h1>
					<p className="mt-2 text-gray-400">
						Sign in with your email to continue
					</p>
				</header>

				<div className="rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
					{displayError && (
						<div
							className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-200"
							role="alert"
						>
							{displayError}
						</div>
					)}

					{status === "success" ? (
						<div
							className="rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-green-200"
							role="status"
						>
							{message}
						</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-6">
							<div>
								<label
									htmlFor="email"
									className="mb-2 block text-sm font-medium text-gray-300"
								>
									Email address
								</label>
								<input
									id="email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="you@company.com"
									required
									autoComplete="email"
									disabled={status === "loading"}
									className="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 focus:border-[#6F44FF] focus:outline-none focus:ring-2 focus:ring-[#6F44FF]/50 disabled:opacity-50"
								/>
							</div>

							{status === "error" && message && (
								<div
									className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-200"
									role="alert"
								>
									{message}
								</div>
							)}

							<button
								type="submit"
								disabled={status === "loading"}
								className="w-full rounded-xl bg-gradient-to-r from-[#6f40ff] to-[#da016e] px-6 py-3 font-semibold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{status === "loading" ? "Sending..." : "Send magic link"}
							</button>
						</form>
					)}
				</div>

				<p className="mt-6 text-center text-sm text-gray-500">
					Only whitelisted email addresses can access this tool.
				</p>
			</div>
		</div>
	);
}
