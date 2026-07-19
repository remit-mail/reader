import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import {
	webClientAlias,
	webClientBuild,
	webClientDefine,
	webClientPlugins,
} from "../vite.base.ts";

/**
 * Reference vite configuration for composing the web-client primitives into a
 * servable bundle. A distributor spreads this into its own vite config (or uses
 * the `build.mjs` CLI, which wraps it). It reuses the shared build base and
 * points the route generator at the installed package's source, so an external
 * consumer's bundler resolves the primitives without further wiring.
 *
 * The auth shell is chosen by which provider the entry imports — not by this
 * config — so there is nothing here to select per deployment.
 */
const packageFile = (relative: string): string =>
	fileURLToPath(new URL(relative, import.meta.url));

export const webClientPreset = (): UserConfig => ({
	plugins: webClientPlugins({
		routesDirectory: packageFile("../src/routes"),
		generatedRouteTree: packageFile("../src/routeTree.gen.ts"),
	}),
	resolve: { alias: webClientAlias() },
	define: webClientDefine(),
	build: webClientBuild(),
});
