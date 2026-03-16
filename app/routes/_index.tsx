import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
	return [
		{ title: "Protocol Validator | Insynctrials" },
		{
			name: "description",
			content: "Validate and structure trial protocol requirements.",
		},
	];
};

export default function Index() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0612] px-4">
			<div className="flex flex-col items-center gap-12">
				<header className="flex flex-col items-center gap-6 text-center">
					<h1 className="font-outfit text-3xl font-bold text-white md:text-4xl">
						Protocol Validator
					</h1>
					<p className="max-w-xl text-lg text-gray-300">
						Validate and structure trial protocol requirements for faster
						startup execution.
					</p>
				</header>
				<div className="rounded-2xl border border-gray-700 bg-gray-900/50 p-8">
					<p className="mb-4 text-gray-300">
						You are signed in. Access the validator tools below.
					</p>
					<a
						href="/logout"
						className="text-sm text-gray-400 hover:text-[#6F44FF] transition-colors"
					>
						Sign out
					</a>
				</div>
			</div>
		</div>
	);
}
