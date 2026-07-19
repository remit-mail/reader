import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";

/**
 * Reference vite configuration for composing the web-client primitives into a
 * servable bundle. A distributor spreads this into its own vite config (or uses
 * the `build.mjs` CLI, which wraps it). It resolves the `@` internal alias into
 * the installed package and selects the `#auth-token` seam for the chosen
 * provider — the two pieces a bundler needs to build the primitives as source.
 */
export type AuthProviderName = "combined" | "cognito" | "better-auth";

export interface WebClientPresetOptions {
	authProvider?: AuthProviderName;
}

const packageFile = (relative: string): string =>
	fileURLToPath(new URL(relative, import.meta.url));

const src = packageFile("../src");
const routesDirectory = packageFile("../src/routes");
const generatedRouteTree = packageFile("../src/routeTree.gen.ts");

const authTokenEntry = (provider: AuthProviderName): string =>
	provider === "better-auth"
		? packageFile("../src/auth/token-better-auth.ts")
		: packageFile("../src/auth/auth-token.ts");

export const webClientPreset = ({
	authProvider = "combined",
}: WebClientPresetOptions = {}): UserConfig => ({
	plugins: [
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
			routesDirectory,
			generatedRouteTree,
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": src,
			"#auth-token": authTokenEntry(authProvider),
		},
	},
	define: {
		__APP_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? "dev"),
		__APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
	},
});
