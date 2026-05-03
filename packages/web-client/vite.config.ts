import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
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
		allowedHosts: ["sandbox"],
		proxy: {
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
