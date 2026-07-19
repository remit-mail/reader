import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Proves the auth shell is a composition choice, not a runtime toggle inside
 * one bundle: a build that composes the better-auth provider contains no
 * Amplify/Cognito code, and one that composes the Cognito provider does. The
 * app shell and screens are walked from the real entry each time, so this fails
 * the moment any surface reaches back to a specific identity SDK.
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const packageDir = join(srcDir, "..");

interface Variant {
	specifier: string;
	name: string;
}

const VARIANTS: Record<"betterAuth" | "cognito", Variant> = {
	betterAuth: {
		specifier: "@/auth/better-auth-provider",
		name: "betterAuthProvider",
	},
	cognito: {
		specifier: "@/auth/cognito-provider",
		name: "cognitoAuthProvider",
	},
};

interface Graph {
	inputs: string[];
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

const bundleGraph = async (variant: Variant): Promise<Graph> => {
	const entry = [
		'import { mountApp } from "@/shell";',
		`import { ${variant.name} } from "${variant.specifier}";`,
		`mountApp({ authProvider: ${variant.name} });`,
		"",
	].join("\n");

	const result = await build({
		stdin: {
			contents: entry,
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

const mentionsAmplify = ({ inputs, importPaths }: Graph): boolean =>
	[...inputs, ...importPaths].some((path) => /aws-amplify/.test(path));

const composesCognitoShell = ({ inputs }: Graph): boolean =>
	inputs.some(
		(path) =>
			path.includes("auth/cognito/") || path.includes("cognito-provider"),
	);

describe("web-client composition", () => {
	it("omits every Amplify/Cognito module when composing the better-auth provider", async () => {
		const graph = await bundleGraph(VARIANTS.betterAuth);

		assert.ok(
			graph.inputs.some((path) => path.includes("shell/index")),
			"the app shell should be walked from the entry",
		);
		assert.equal(
			mentionsAmplify(graph),
			false,
			"a better-auth build must not reference aws-amplify anywhere in its graph",
		);
		assert.equal(
			composesCognitoShell(graph),
			false,
			"a better-auth build must not pull the Cognito shell",
		);
	});

	it("includes the Amplify/Cognito modules when composing the cognito provider", async () => {
		const graph = await bundleGraph(VARIANTS.cognito);

		assert.equal(
			mentionsAmplify(graph),
			true,
			"a cognito build must reference aws-amplify",
		);
		assert.equal(
			composesCognitoShell(graph),
			true,
			"a cognito build must pull the Cognito shell",
		);
	});
});
