import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function resolveGitSha(): string {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
	} catch {
		return "dev";
	}
}

const APP_SHA = resolveGitSha();

// Serve /config.js from REMIT_RUNTIME_CONFIG (a JSON string) during dev so a run
// mode can pick its runtime config — the dev-server equivalent of the static
// default in public/config.js. Falls through to the static file when unset.
function runtimeConfigDevServer(): Plugin {
	return {
		name: "remit-runtime-config-dev",
		apply: "serve",
		configureServer(server) {
			const override = process.env.REMIT_RUNTIME_CONFIG;
			if (!override) return;
			server.middlewares.use((req, res, next) => {
				if (req.url !== "/config.js") return next();
				res.setHeader("Content-Type", "application/javascript");
				res.end(`window.__REMIT_CONFIG__ = ${override};`);
			});
		},
	};
}

export default defineConfig({
	define: {
		__APP_SHA__: JSON.stringify(APP_SHA),
		__APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
	},
	plugins: [
		runtimeConfigDevServer(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		host: "0.0.0.0",
		allowedHosts: [
			os.hostname(),
			"sandbox",
			"devbox",
			...(process.env.VITE_ALLOWED_HOST ? [process.env.VITE_ALLOWED_HOST] : []),
			".ts.net",
		],
		proxy: {
			// better-auth is mounted at /api/auth on the backend and must keep
			// that prefix, so this rule (matched before the stripping `/api` rule)
			// forwards without rewriting. Regular API routes below drop `/api`.
			"/api/auth": {
				target: `http://localhost:${process.env.VITE_PROXY_BACKEND_PORT ?? "5433"}`,
				changeOrigin: true,
			},
			"/api": {
				target: `http://localhost:${process.env.VITE_PROXY_BACKEND_PORT ?? "5433"}`,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ""),
			},
			// Forward CloudFront-style content requests to the dev-server's
			// local stand-in. In production this path is served by CloudFront
			// + Lambda@Edge; in dev/smoke/e2e the dev-server reads from the
			// filesystem-backed storage tree.
			"/content": {
				target: `http://localhost:${process.env.VITE_PROXY_BACKEND_PORT ?? "5433"}`,
				changeOrigin: true,
			},
		},
	},
});
