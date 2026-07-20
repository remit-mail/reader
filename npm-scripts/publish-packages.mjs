#!/usr/bin/env node
// Registry-gated publishing for every publishable @remit/* package: the
// workspace services under packages/ and the TypeSpec-generated packages under
// build/. The public registry is the single source of truth for versions —
// there are no changeset files and no committed version bumps.
//
// Per package each run: build a deterministic content hash of the freshly packed
// output and compare it against the version currently on the registry. Identical
// -> skip. Different -> publish a patch bump over the registry's latest. Absent
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
import { execFileSync } from "node:child_process";
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const repositoryUrl = "git+https://github.com/remit-mail/reader.git";

// TypeSpec-generated packages, in dependency order (all are leaves).
// `peerDependencies` names the runtime libraries the built output imports but
// expects the consumer to supply — merged onto whatever the emitter declared so
// a standalone install resolves them.
const generated = [
	{ dir: "build/ts-enums", name: "@remit/domain-enums", peerDependencies: {} },
	{
		dir: "build/openapi-types",
		name: "@remit/api-openapi-types",
		peerDependencies: {},
	},
	{
		dir: "build/zod-schemas",
		name: "@remit/api-zod-schemas",
		peerDependencies: { zod: "^3.0.0" },
	},
	{
		dir: "build/ddb-entities",
		name: "@remit/electrodb-entities",
		peerDependencies: { electrodb: ">=3.0.0" },
	},
	{
		dir: "build/remit-client",
		name: "@remit/api-http-client",
		peerDependencies: { "@tanstack/react-query": "^5.0.0" },
	},
	{
		dir: "build/drizzle-entities",
		name: "@remit/drizzle-pg-schema",
		peerDependencies: {},
	},
	{
		dir: "build/drizzle-entities-sqlite",
		name: "@remit/drizzle-sqlite-schema",
		peerDependencies: {},
	},
	// The @typespec/openapi3 emitter writes only openapi.json, no manifest, so
	// the publish tool synthesizes one. The spec ships as a data package: the
	// closed platform resolves openapi.json from it instead of a local build tree.
	{
		dir: "build/remit-openapi3",
		name: "@remit/api-openapi-spec",
		peerDependencies: {},
		manifest: {
			name: "@remit/api-openapi-spec",
			version: "0.0.0",
			description: "Remit API OpenAPI 3 document, generated from TypeSpec.",
			exports: { ".": "./openapi.json", "./openapi.json": "./openapi.json" },
			files: ["openapi.json"],
		},
	},
	// The built web client as a static-asset data package: index.html, the
	// hashed asset bundle, locales, and the default runtime config.js
	// (better-auth self-host). A deployment installs it and replaces config.js
	// with its own values instead of building the client from source. `build`
	// runs the vite build (which empties dist/) before the manifest is
	// synthesized into it, so packing sees a fresh tree.
	{
		dir: "packages/web-client/dist",
		name: "@remit/web-client-dist",
		peerDependencies: {},
		build: ["npm", ["run", "build", "-w", "@remit/web-client"]],
		manifest: {
			name: "@remit/web-client-dist",
			version: "0.0.0",
			description:
				"Built Remit web client — static assets and the default runtime config.",
			files: ["**/*"],
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

const freshContentHash = (pkgDir) =>
	withTempDir((tempDir) => {
		run("npm", ["pack", "--pack-destination", tempDir, "--loglevel=error"], {
			cwd: join(repoRoot, pkgDir),
		});
		return hashPackageDir(extractedTarballDir(tempDir));
	});

const publishedContentHash = (name, version) =>
	withTempDir((tempDir) => {
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
		);
		return hashPackageDir(extractedTarballDir(tempDir));
	});

const registryLatest = (name) => {
	try {
		return run("npm", ["view", name, "version", "--loglevel=error"], {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
		if (text.includes("E404") || text.includes("404")) return null;
		throw error;
	}
};

const patchBump = (version) => {
	const [major, minor, patch] = version.split(".").map(Number);
	return `${major}.${minor}.${patch + 1}`;
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

const stampGeneratedMetadata = ({ dir, peerDependencies }) => {
	const manifestPath = join(repoRoot, dir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.license = "MIT";
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

const publish = (pkgDir) =>
	run("npm", ["publish", "--access", "public"], {
		cwd: join(repoRoot, pkgDir),
		stdio: "inherit",
	});

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
	console.log("\nConsumer typecheck acceptance...\n");
	run("node", ["npm-scripts/check-consumer-typecheck.mjs"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

const packages = [...generated, ...workspacePackages()];
const summary = [];
const failures = [];

for (const pkg of packages) {
	if (pkg.kind !== "workspace") {
		if (pkg.build)
			run(pkg.build[0], pkg.build[1], { cwd: repoRoot, stdio: "inherit" });
		synthesizeManifest(pkg);
		stampGeneratedMetadata(pkg);
	}
	const fresh = freshContentHash(pkg.dir);
	const latest = registryLatest(pkg.name);

	let target;
	if (latest === null) {
		target = "0.0.1";
		summary.push({
			name: pkg.name,
			decision: `seed ${target} (not on registry)`,
		});
	} else if (publishedContentHash(pkg.name, latest) === fresh) {
		summary.push({ name: pkg.name, decision: `skip (identical to ${latest})` });
		continue;
	} else {
		target = patchBump(latest);
		summary.push({
			name: pkg.name,
			decision: `publish ${latest} -> ${target}`,
		});
	}

	if (dryRun) {
		packCheck(pkg.dir);
		continue;
	}
	setVersion(pkg.dir, target);
	try {
		publish(pkg.dir);
		console.log(`published ${pkg.name}@${target}`);
	} catch (error) {
		failures.push({ name: pkg.name, version: target, error: error.message });
	}
}

console.log(`\n${dryRun ? "Dry run" : "Publish"} decisions:`);
for (const { name, decision } of summary) console.log(`  ${name}: ${decision}`);

if (failures.length > 0) {
	console.error("\nPublish failures:");
	for (const f of failures)
		console.error(`  ${f.name}@${f.version}: ${f.error}`);
	process.exit(1);
}
