#!/usr/bin/env node
// Generated packages live in gitignored build/, so no commit touches them; they
// release on changes to the inputs listed in their `rootFiles`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import multiSemanticRelease from "@anolilab/multi-semantic-release";
import { GENERATED_PACKAGES } from "./lib/generated-packages.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const repositoryUrl = "git+https://github.com/remit-mail/reader.git";
const releaseBranch = "main";
const dryRunBranch = "semantic-release-dry-run";

// `peerDependencies` names the runtime libraries the built output imports but
// expects the consumer to supply — merged onto whatever the emitter declared so
// a standalone install resolves them.
const generatedPeerDependencies = {
	"@remit/electrodb-entities": { electrodb: ">=3.0.0" },
	"@remit/api-http-client": { "@tanstack/react-query": "^5.0.0" },
	"@remit/api-openapi-spec": { ajv: "^8.0.0" },
};
const typespecPackages = GENERATED_PACKAGES.map(({ dir, name }) => ({
	dir,
	name,
	peerDependencies: generatedPeerDependencies[name] ?? {},
}));
const typespecInputs = [
	"typespec",
	"openapi-ts.config.js",
	"npm-scripts/generate-request-validators.mjs",
];

// The Hunspell WebAssembly engine npm run build:hunspell compiles from
// docker/hunspell/. The web client stages it into its build, and only this repo
// runs the Emscripten toolchain that produces it.
const spellcheckEngine = {
	dir: "build/hunspell",
	name: "@remit/spellcheck-engine",
	peerDependencies: {},
	license: "(MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later)",
	manifest: {
		name: "@remit/spellcheck-engine",
		version: "0.0.0",
		description:
			"Hunspell compiled to WebAssembly for the Remit composer spellchecker, with its licence texts and the pins it was built from.",
		files: [
			"hunspell.wasm",
			"hunspell.mjs",
			"LICENSE",
			"license.hunspell",
			"pin.env",
		],
		exports: {
			"./package.json": "./package.json",
			"./hunspell.mjs": "./hunspell.mjs",
			"./hunspell.wasm": "./hunspell.wasm",
		},
	},
};
const spellcheckInputs = [
	"docker/hunspell",
	"npm-scripts/build-hunspell.mjs",
	".github/actions/hunspell",
];

const generated = [...typespecPackages, spellcheckEngine];

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot, ...opts });

const readManifest = (dir) =>
	JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));

const workspacePackages = () =>
	readdirSync(join(repoRoot, "packages"))
		.map((name) => join("packages", name))
		.filter((dir) => {
			try {
				return !readManifest(dir).private;
			} catch {
				return false;
			}
		});

const synthesizeManifest = ({ dir, manifest }) => {
	if (!manifest) return;
	writeFileSync(
		join(repoRoot, dir, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
};

const stampGeneratedMetadata = ({ dir, peerDependencies, license }) => {
	const manifestPath = join(repoRoot, dir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.license = license ?? "MIT";
	manifest.publishConfig = { ...manifest.publishConfig, access: "public" };
	manifest.repository = { type: "git", url: repositoryUrl };
	if (Object.keys(peerDependencies).length > 0) {
		manifest.peerDependencies = {
			...manifest.peerDependencies,
			...peerDependencies,
		};
	}
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

// multi-semantic-release finds packages only through the root `workspaces`, and
// build/ cannot stay there because npm resolves it through `file:build/*`
// dependencies, so the generated directories join the list for the run only.
const withGeneratedWorkspaces = async (fn) => {
	const manifestPath = join(repoRoot, "package.json");
	const original = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(original);
	manifest.workspaces = [
		...manifest.workspaces,
		...generated.map(({ dir }) => dir),
	];
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	try {
		return await fn();
	} finally {
		writeFileSync(manifestPath, original);
	}
};

// semantic-release reads the branch from the CI environment and refuses any
// branch it is not configured for, so the dry run hides the CI from it and
// releases from whatever branch is checked out. A pull request's merge commit
// is a detached HEAD, which gets a throwaway branch for the run.
const withDryRunBranch = async (fn) => {
	const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	if (current !== "HEAD") return await fn(current);
	const head = run("git", ["rev-parse", "HEAD"]).trim();
	run("git", ["switch", "--quiet", "--create", dryRunBranch]);
	try {
		return await fn(dryRunBranch);
	} finally {
		run("git", ["switch", "--quiet", "--detach", head]);
		run("git", ["branch", "--quiet", "--delete", "--force", dryRunBranch]);
	}
};

const plugins = [
	[
		"@semantic-release/commit-analyzer",
		{
			preset: "conventionalcommits",
			releaseRules: [
				{ breaking: true, release: "major" },
				{ type: "feat", release: "minor" },
				{ type: "*", release: "patch" },
				{ type: "test", release: false },
				{ type: "docs", release: false },
			],
		},
	],
	...(dryRun ? [] : ["@semantic-release/npm"]),
];

const release = async ({ paths, rootFiles, branch, env }) =>
	await multiSemanticRelease(
		paths,
		{
			plugins,
			...(dryRun ? { repositoryUrl: pathToFileURL(repoRoot).href } : {}),
		},
		{ cwd: repoRoot, env },
		{
			dryRun,
			branches: [branch],
			deps: { bump: "satisfy" },
			rootFiles,
		},
	);

const manifestPaths = (dirs) => dirs.map((dir) => join(dir, "package.json"));

const releaseAll = async (branch, env) => [
	...(await release({
		paths: manifestPaths([
			...typespecPackages.map(({ dir }) => dir),
			...workspacePackages(),
		]),
		rootFiles: {
			files: typespecInputs,
			packages: typespecPackages.map(({ name }) => name),
		},
		branch,
		env,
	})),
	...(await release({
		paths: manifestPaths([spellcheckEngine.dir]),
		rootFiles: { files: spellcheckInputs, packages: [spellcheckEngine.name] },
		branch,
		env,
	})),
];

const describe = ({ result }) => {
	if (!result?.nextRelease) return "no release";
	const { lastRelease, nextRelease } = result;
	return `${lastRelease?.version ?? "none"} -> ${nextRelease.version} (${nextRelease.type})`;
};

console.log("Checking publish closure...\n");
run("node", ["npm-scripts/check-publish-closure.mjs"], { stdio: "inherit" });

// The dry run is the pre-publish gate every pull request passes. Verify the
// closure guard's own logic, then compile a clean-install consumer against the
// heaviest package so a missing @types — which the static scan cannot see —
// fails here rather than in a downstream build.
if (dryRun) {
	console.log("\nVerifying publish-closure guard...\n");
	run("node", ["--test", "npm-scripts/lib/publish-closure.test.mjs"], {
		stdio: "inherit",
	});
	console.log("\nConsumer typecheck acceptance...\n");
	run("node", ["npm-scripts/check-consumer-typecheck.mjs"], {
		stdio: "inherit",
	});
}

for (const pkg of generated) {
	synthesizeManifest(pkg);
	stampGeneratedMetadata(pkg);
}

const dryRunEnv = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => key !== "GITHUB_ACTIONS"),
);
// Stops `npm version` in a package from reinstalling the whole workspace.
const releaseEnv = { ...process.env, npm_config_workspaces_update: "false" };

const packages = await withGeneratedWorkspaces(() =>
	dryRun
		? withDryRunBranch((branch) => releaseAll(branch, dryRunEnv))
		: releaseAll(releaseBranch, releaseEnv),
);

if (dryRun) {
	for (const { dir, result } of packages) {
		if (!result?.nextRelease) continue;
		run("npm", ["pack", "--dry-run", "--loglevel=error"], {
			cwd: dir,
			stdio: "inherit",
		});
	}
}

console.log(`\n${dryRun ? "Dry run" : "Publish"} decisions:`);
for (const pkg of packages) console.log(`  ${pkg.name}: ${describe(pkg)}`);

const untagged = packages.filter(
	({ result }) => result?.nextRelease && !result.lastRelease?.version,
);
if (dryRun && untagged.length > 0) {
	console.error(
		"\nNo previous release tag; seed one by hand before publishing:",
	);
	for (const { name } of untagged) console.error(`  ${name}`);
	process.exit(1);
}
