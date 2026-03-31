import { defineConfig, type Plugin } from "vite";

/** Chrome DevTools probes this URL; without a handler Remix logs a scary 404 in dev. */
function chromeDevToolsWellKnown(): Plugin {
	return {
		name: "chrome-devtools-well-known",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split("?")[0] ?? "";
				if (
					path === "/.well-known/appspecific/com.chrome.devtools.json"
				) {
					res.setHeader("Content-Type", "application/json");
					res.end("{}");
					return;
				}
				next();
			});
		},
	};
}
import {
	vitePlugin as remix,
	cloudflareDevProxyVitePlugin,
} from "@remix-run/dev";
import tsconfigPaths from "vite-tsconfig-paths";
import { getLoadContext } from "./load-context";

declare module "@remix-run/cloudflare" {
	interface Future {
		v3_singleFetch: true;
	}
}

export default defineConfig({
	plugins: [
		chromeDevToolsWellKnown(),
		cloudflareDevProxyVitePlugin({
			getLoadContext,
		}),
		remix({
			future: {
				v3_fetcherPersist: true,
				v3_relativeSplatPath: true,
				v3_throwAbortReason: true,
				v3_singleFetch: true,
				v3_lazyRouteDiscovery: true,
			},
		}),
		tsconfigPaths(),
	],
	ssr: {
		resolve: {
			conditions: ["workerd", "worker", "browser"],
		},
	},
	resolve: {
		mainFields: ["browser", "module", "main"],
	},
	build: {
		minify: true,
	},
});
