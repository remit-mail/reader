import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { AliasOptions, PluginOption } from "vite";

/**
 * The one place the web-client build toolchain is described. Both the dev
 * server (`vite.config.ts`) and the distributor harness (`harness/vite-preset`)
 * build from these pieces, so the plugin list, the `@` alias, and the build-time
 * defines exist exactly once.
 */
const resolveGitSha = (): string => {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
	} catch {
		return "dev";
	}
};

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export interface RouterPaths {
	/** Where the route files live. Defaults to `<pkg>/src/routes`. */
	routesDirectory?: string;
	/** Where the generated route tree is written. Defaults to `<pkg>/src/routeTree.gen.ts`. */
	generatedRouteTree?: string;
}

export const webClientAlias = (): AliasOptions => ({ "@": srcDir });

export const webClientDefine = (): Record<string, string> => ({
	__APP_SHA__: JSON.stringify(resolveGitSha()),
	__APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
});

export const webClientPlugins = (routes: RouterPaths = {}): PluginOption[] => [
	tanstackRouter({ target: "react", autoCodeSplitting: true, ...routes }),
	react(),
	tailwindcss(),
];
