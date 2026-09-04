import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Walks the app the way a distributor's build walks it — from the shell entry,
 * with one identity system composed in — and hands back the module graph the
 * bundler resolved. A suite asserts on that graph rather than on import text: a
 * specifier reads the same whether or not anything resolves it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const packageDir = join(srcDir, "..");

/** An identity system a build composes, by the export that supplies it. */
export interface AuthComposition {
	specifier: string;
	name: string;
}

export const AUTH_COMPOSITIONS: Record<
	"betterAuth" | "cognito",
	AuthComposition
> = {
	betterAuth: {
		specifier: "@/auth/better-auth-provider",
		name: "betterAuthProvider",
	},
	cognito: {
		specifier: "@/auth/cognito-provider",
		name: "cognitoAuthProvider",
	},
};

export interface AppGraph {
	/** Every file the bundler pulled in, relative to the package root. */
	inputs: string[];
	/** Every specifier those files import, as the bundler resolved it. */
	importPaths: string[];
}

// Externalize third-party packages, but bundle in-repo `@remit/*` workspace
// source so the walk matches what the real vite build includes. A shared
// primitive (e.g. `@remit/ui`) that pulled in Amplify would then surface in this
// graph and fail the test, rather than hiding behind an external edge.
const externalizeThirdParty = {
	name: "externalize-third-party",
	setup(build: import("esbuild").PluginBuild) {
		build.onResolve({ filter: /.*/ }, (args) => {
			const path = args.path;
			if (path.startsWith(".") || path.startsWith("/")) return null;
			if (path === "@" || path.startsWith("@/")) return null;
			if (path.startsWith("@remit/")) return null;
			return { path, external: true };
		});
	},
};

/** Bundle the app against `auth` and report everything the build reached. */
export const bundleAppGraph = async (
	auth: AuthComposition,
): Promise<AppGraph> => {
	const result = await build({
		stdin: {
			contents: [
				'import { mountApp } from "@/shell";',
				`import { ${auth.name} } from "${auth.specifier}";`,
				`mountApp({ authProvider: ${auth.name} });`,
				"",
			].join("\n"),
			resolveDir: packageDir,
			loader: "tsx",
			sourcefile: "compose-entry.tsx",
		},
		bundle: true,
		write: false,
		metafile: true,
		logLevel: "silent",
		format: "esm",
		platform: "browser",
		jsx: "automatic",
		jsxImportSource: "react",
		plugins: [externalizeThirdParty],
		// A stylesheet is emptied rather than parsed: this walk is after which
		// files the build reaches, and what one sheet `@import`s from another is
		// the app stylesheet's business, not the module graph's.
		loader: { ".css": "empty", ".png": "empty", ".svg": "empty" },
		absWorkingDir: packageDir,
		alias: { "@": srcDir },
	});

	const inputs = Object.keys(result.metafile.inputs);
	const importPaths = new Set<string>();
	for (const input of Object.values(result.metafile.inputs)) {
		for (const imported of input.imports) importPaths.add(imported.path);
	}
	return { inputs, importPaths: [...importPaths] };
};

/** An input path from a graph, as an absolute path on this checkout. */
export const graphPath = (input: string): string => join(packageDir, input);
