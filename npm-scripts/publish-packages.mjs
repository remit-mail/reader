#!/usr/bin/env node
// Registry-gated publishing for every publishable @remit/* package: the
// workspace services under packages/ and the TypeSpec-generated packages under
// build/. The public registry is the single source of truth for versions —
// there are no changeset files and no committed version bumps.
//
// Per package each run: build a deterministic content hash of the freshly packed
// output and compare it against the version currently on the registry. Identical
// -> skip. Different -> publish over the registry's latest: a minor bump when the
// new version removes an export or changes its declaration (the packages are
// pre-1.0, so the minor is the breaking digit), a patch bump otherwise. Absent
// -> seed 0.0.1. The hash normalizes the version field and hashes file contents,
// so tarball timestamps and the version string never trigger a spurious
// republish; `*` inter-package ranges keep an upstream bump from cascading into a
// dependent's content. Idempotent and safe on every run.
//
// Generated packages publish before the workspace set that depends on them.
// Version bumps are written into the working-tree manifest only when actually
// publishing (never in dry-run) and are never committed — CI runs on an ephemeral
// checkout.
//
// Usage: publish-packages.mjs [--dry-run]
//   --dry-run  compute and print each decision, pack-check, never publish.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { apiBreaks, apiSurface } from "./lib/api-diff.mjs";
import { GENERATED_PACKAGES } from "./lib/generated-packages.mjs";
import {
	isMissingPackage,
	withVersionPropagation,
} from "./lib/registry-fetch.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const repositoryUrl = "git+https://github.com/remit-mail/reader.git";

// The TypeSpec-generated packages (dir/name mapping shared with
// check-consumer-typecheck.mjs via lib/generated-packages.mjs), in dependency
// order (all are leaves), plus the spellchecker's engine as a data package.
// `peerDependencies` names the runtime libraries the built output imports but
// expects the consumer to supply — merged onto whatever the emitter declared so
// a standalone install resolves them.
const generatedPeerDependencies = {
	"@remit/electrodb-entities": { electrodb: ">=3.0.0" },
	"@remit/api-http-client": { "@tanstack/react-query": "^5.0.0" },
	"@remit/api-openapi-spec": { ajv: "^8.0.0" },
};
const generated = [
	...GENERATED_PACKAGES.map(({ dir, name }) => ({
		dir,
		name,
		peerDependencies: generatedPeerDependencies[name] ?? {},
	})),
	// The Hunspell WebAssembly engine npm run build:hunspell compiles from
	// docker/hunspell/. The web client stages it into its build, and only this
	// repo runs the Emscripten toolchain that produces it.
	{
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
	},
];

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

const readManifest = (dir) =>
	JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));

// Publishable workspace packages: everything under packages/ not marked private.
const workspacePackages = () => {
	const out = [];
	for (const name of readdirSync(join(repoRoot, "packages"))) {
		const dir = join("packages", name);
		let manifest;
		try {
			manifest = readManifest(dir);
		} catch {
			continue;
		}
		if (manifest.private) continue;
		out.push({ dir, name: manifest.name, kind: "workspace" });
	}
	return out;
};

const walkFiles = (root) => {
	const out = [];
	const recurse = (current) => {
		for (const entry of readdirSync(current)) {
			const path = join(current, entry);
			if (statSync(path).isDirectory()) recurse(path);
			else out.push(path);
		}
	};
	recurse(root);
	return out;
};

// Hash of an extracted package: version normalized to a constant, then the
// sha256 of each file's bytes combined with its path, ordered by path. The same
// function runs over the freshly packed output and the downloaded registry
// tarball, so equal content yields equal hashes regardless of version or tar
// metadata.
const hashPackageDir = (packageDir) => {
	const manifestPath = join(packageDir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.version = "0.0.0";
	writeFileSync(manifestPath, JSON.stringify(manifest));

	const files = walkFiles(packageDir)
		.map((path) => relative(packageDir, path))
		.sort();
	const combined = createHash("sha256");
	for (const rel of files) {
		const fileHash = createHash("sha256")
			.update(readFileSync(join(packageDir, rel)))
			.digest("hex");
		combined.update(`${fileHash}\0${rel}\n`);
	}
	return combined.digest("hex");
};

const withTempDir = (fn) => {
	const dir = mkdtempSync(join(tmpdir(), "remit-pack-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

const extractedTarballDir = (tempDir) => {
	const tarball = readdirSync(tempDir).find((f) => f.endsWith(".tgz"));
	run("tar", ["-xzf", join(tempDir, tarball), "-C", tempDir]);
	return join(tempDir, "package");
};

const inspectPackageDir = (packageDir) => ({
	api: apiSurface(ts, packageDir),
	hash: hashPackageDir(packageDir),
});

const freshPackage = (pkgDir) =>
	withTempDir((tempDir) => {
		run("npm", ["pack", "--pack-destination", tempDir, "--loglevel=error"], {
			cwd: join(repoRoot, pkgDir),
		});
		return inspectPackageDir(extractedTarballDir(tempDir));
	});

// The version this compares against was read from the packument a moment ago,
// which is ahead of the replicas: a publish on main and a pull request's dry run
// raced, and the run died on a tarball the registry had accepted but not yet
// served. The pack is retried while that is what ETARGET means, and the last
// attempt's failure ends the run as before.
const publishedPackage = (name, version) =>
	withTempDir((tempDir) => {
		withVersionPropagation(() =>
			run(
				"npm",
				[
					"pack",
					`${name}@${version}`,
					"--pack-destination",
					tempDir,
					"--loglevel=error",
				],
				{
					cwd: repoRoot,
				},
			),
		);
		return inspectPackageDir(extractedTarballDir(tempDir));
	});

const registryLatest = (name) => {
	try {
		return run("npm", ["view", name, "version", "--loglevel=error"], {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		if (isMissingPackage(error)) return null;
		throw error;
	}
};

const patchBump = (version) => {
	const [major, minor, patch] = version.split(".").map(Number);
	return `${major}.${minor}.${patch + 1}`;
};

const minorBump = (version) => {
	const [major, minor] = version.split(".").map(Number);
	return `${major}.${minor + 1}.0`;
};

const setVersion = (pkgDir, version) => {
	const manifestPath = join(repoRoot, pkgDir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.version = version;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

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

// One package failing must not abandon the rest of the run, so this reports the
// outcome instead of throwing; the caller collects failures and exits non-zero.
// Verbose, because npm logs a refused trusted-publishing token exchange only at
// that level and otherwise reports it as a bare ENEEDAUTH.
const publish = (pkgDir) => {
	const { error, status, signal } = spawnSync(
		"npm",
		[
			"publish",
			"--access",
			"public",
			...(process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : []),
			"--loglevel=verbose",
		],
		{ cwd: join(repoRoot, pkgDir), stdio: "inherit" },
	);
	if (error) return { ok: false, error: error.message };
	if (signal) return { ok: false, error: `npm publish killed by ${signal}` };
	if (status !== 0) return { ok: false, error: `npm publish exited ${status}` };
	return { ok: true };
};

const packCheck = (pkgDir) =>
	run("npm", ["pack", "--dry-run", "--loglevel=error"], {
		cwd: join(repoRoot, pkgDir),
		stdio: "inherit",
	});

console.log("Checking publish closure...\n");
run("node", ["npm-scripts/check-publish-closure.mjs"], {
	cwd: repoRoot,
	stdio: "inherit",
});

// The dry run is the pre-publish gate every pull request passes. Verify the
// closure guard's own logic, then compile a clean-install consumer against the
// heaviest package so a missing @types — which the static scan cannot see —
// fails here rather than in a downstream build.
if (dryRun) {
	console.log("\nVerifying publish-closure guard...\n");
	run("node", ["--test", "npm-scripts/lib/publish-closure.test.mjs"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
	console.log("\nVerifying the API diff that picks the bump...\n");
	run("node", ["--test", "npm-scripts/lib/api-diff.test.mjs"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
	console.log("\nConsumer typecheck acceptance...\n");
	run("node", ["npm-scripts/check-consumer-typecheck.mjs"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

if (!dryRun)
	console.log(`\nPublishing with npm ${run("npm", ["--version"]).trim()}\n`);

const packages = [...generated, ...workspacePackages()];
const summary = [];
const failures = [];

for (const pkg of packages) {
	if (pkg.kind !== "workspace") {
		synthesizeManifest(pkg);
		stampGeneratedMetadata(pkg);
	}
	const fresh = freshPackage(pkg.dir);
	const latest = registryLatest(pkg.name);

	let target;
	if (latest === null) {
		target = "0.0.1";
		summary.push({
			name: pkg.name,
			decision: `seed ${target} (not on registry)`,
			breaks: [],
		});
	} else {
		const published = publishedPackage(pkg.name, latest);
		if (published.hash === fresh.hash) {
			summary.push({
				name: pkg.name,
				decision: `skip (identical to ${latest})`,
				breaks: [],
			});
			continue;
		}
		const breaks = apiBreaks(published.api, fresh.api);
		const bump = breaks.length > 0 ? "minor" : "patch";
		target = bump === "minor" ? minorBump(latest) : patchBump(latest);
		summary.push({
			name: pkg.name,
			decision: `publish ${latest} -> ${target} (${bump})`,
			breaks,
		});
	}

	if (dryRun) {
		packCheck(pkg.dir);
		continue;
	}
	setVersion(pkg.dir, target);
	const { ok, error } = publish(pkg.dir);
	if (ok) console.log(`published ${pkg.name}@${target}`);
	else failures.push({ name: pkg.name, version: target, error });
}

console.log(`\n${dryRun ? "Dry run" : "Publish"} decisions:`);
for (const { name, decision, breaks } of summary) {
	console.log(`  ${name}: ${decision}`);
	for (const line of breaks) console.log(`    ${line}`);
}

if (failures.length > 0) {
	console.error("\nPublish failures:");
	for (const f of failures)
		console.error(`  ${f.name}@${f.version}: ${f.error}`);
	process.exit(1);
}
