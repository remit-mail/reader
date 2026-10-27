import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { webClientPreset } from "@remit/web-client/vite-preset";
import { defineConfig, type Plugin } from "vite";

const webClientPublic = join(
	dirname(
		createRequire(import.meta.url).resolve("@remit/web-client/vite-preset"),
	),
	"..",
	"public",
);

const runtimeConfigPreview = (): Plugin => ({
	name: "remit-runtime-config-preview",
	configurePreviewServer(server) {
		const override = process.env.REMIT_RUNTIME_CONFIG;
		if (!override) return;
		server.middlewares.use((req, res, next) => {
			if (req.url !== "/config.js") return next();
			res.setHeader("Content-Type", "application/javascript");
			res.end(`window.__REMIT_CONFIG__ = ${override};`);
		});
	},
});

const backend = `http://localhost:${process.env.VITE_PROXY_BACKEND_PORT ?? "5433"}`;
const preset = webClientPreset();

export default defineConfig({
	...preset,
	plugins: [runtimeConfigPreview(), ...(preset.plugins ?? [])],
	publicDir: webClientPublic,
	build: { ...preset.build, outDir: "dist", emptyOutDir: true },
	preview: {
		host: "0.0.0.0",
		allowedHosts: [
			hostname(),
			"sandbox",
			"devbox",
			...(process.env.VITE_ALLOWED_HOST ? [process.env.VITE_ALLOWED_HOST] : []),
			".ts.net",
		],
		proxy: {
			"/api/auth": { target: backend, changeOrigin: true },
			"/api": {
				target: backend,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ""),
			},
			"/content": { target: backend, changeOrigin: true },
			"/feeds/calendar": { target: backend, changeOrigin: true },
			"/outbox-upload": { target: backend, changeOrigin: true },
		},
	},
});
