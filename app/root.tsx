import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteLoaderData,
} from "@remix-run/react";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";

import { checkAuthAndWhitelist } from "./lib/auth";
import { getWhitelistEmails } from "./lib/whitelist";

import "./tailwind.css";

export async function loader({ request, context }: LoaderFunctionArgs) {
	const env = context.cloudflare.env as Env;
	const whitelistEmails = await getWhitelistEmails(env);
	const session = checkAuthAndWhitelist(request, whitelistEmails);
	return json({ isSignedIn: !!session });
}

export const links: LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Outfit:ital,wght@0,100..900;1,100..900&display=swap",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:ital,wght@0,300..700;1,300..700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="theme-color" content="#0a0612" />
				<Meta />
				<Links />
			</head>
			<body className="font-sans bg-[#0a0612] text-white">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	const data = useRouteLoaderData<{ isSignedIn: boolean }>("root");

	return (
		<div className="flex min-h-screen flex-col">
			<nav className="sticky top-0 z-50 border-b border-gray-700/50 bg-[#0a0612]/95 backdrop-blur-sm">
				<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
					<a
						href="/"
						className="font-outfit text-xl font-semibold text-white transition-colors hover:text-[#6F44FF]"
					>
						Protocol Validator
					</a>
					{data?.isSignedIn && (
						<a
							href="/logout"
							className="text-base text-gray-400 transition-colors hover:text-white"
						>
							Sign out
						</a>
					)}
				</div>
			</nav>

			<main className="flex-1 pb-16">
				<Outlet />
			</main>

			<footer className="border-t border-gray-700/50 bg-gray-900/30 py-8">
				<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
					<p className="text-sm text-gray-500">
						© {new Date().getFullYear()} Insynctrials. All rights reserved.
					</p>
					<p className="mt-4 text-xs text-gray-600">
						Validate and structure trial protocol requirements for faster startup
						execution.
					</p>
				</div>
			</footer>
		</div>
	);
}
