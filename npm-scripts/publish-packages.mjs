#!/usr/bin/env node
// Registry-gated publishing for every publishable @remit/* package: the
// workspace services under packages/ and the TypeSpec-generated packages under
// build/. The public registry is the single source of truth for versions —
// there are no changeset files and no committed version bumps.
//
// Per package each run: build a deterministic content hash of the freshly packed
// output and compare it against the version currently on the registry. Identical
// -> skip. Different -> stage a patch bump over the registry's latest. Absent
// -> seed 0.0.1. The hash normalizes the version field and hashes file contents,
// so tarball timestamps and the version string never trigger a spurious
// republish; `*` inter-package ranges keep an upstream bump from cascading into a
// dependent's content. Idempotent and safe on every run.
//
// CI only stages (`npm stage publish`); a maintainer releases each staged
// version with 2FA through `npm run release:approve`. A staged version is
// invisible to `npm view` and the CI token cannot list stages, so a run that
// finds its patch bump already staged skips the package: that version is still
// awaiting approval, and the first run after it is released stages any newer
// content as the next patch.
//
// Generated packages publish before the workspace set that depends on them.
// Version bumps are written into the working-tree manifest only when actually
// publishing (never in dry-run) and are never committed — CI runs on an ephemeral
// checkout.
//
// Usage: publish-packages.mjs [--dry-run]
//   --dry-run  compute and print each decision, pack-check, never stage.
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
import { publishablePackages } from "./lib/publishable-packages.mjs";
import {
	isMissingPackage,
	isVersionTaken,
	withVersionPropagation,
} from "./lib/registry-fetch.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const repositoryUrl = "git+https://github.com/remit-mail/reader.git";

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

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

// The version this compares against was read from the packument a moment ago,
// which is ahead of the replicas: a publish on main and a pull request's dry run
// raced, and the run died on a tarball the registry had accepted but not yet
// served. The pack is retried while that is what ETARGET means, and the last
// attempt's failure ends the run as before.
const publishedContentHash = (name, version) =>
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
		return hashPackageDir(extractedTarballDir(tempDir));
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

// One package failing must not abandon the rest of the run, so this reports the
// outcome instead of throwing; the caller collects failures and exits non-zero.
// Verbose, because npm logs a refused trusted-publishing token exchange only at
// that level and otherwise reports it as a bare ENEEDAUTH.
const stage = (pkgDir) => {
	const { error, status, signal, stderr } = spawnSync(
		"npm",
		[
			"stage",
			"publish",
			"--access",
			"public",
			"--provenance",
			"--loglevel=verbose",
		],
		{
			cwd: join(repoRoot, pkgDir),
			stdio: ["ignore", "inherit", "pipe"],
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (stderr) process.stderr.write(stderr);
	if (error) return { outcome: "failed", error: error.message };
	if (signal)
		return {
			outcome: "failed",
			error: `npm stage publish killed by ${signal}`,
		};
	if (status === 0) return { outcome: "staged" };
	if (isVersionTaken({ stderr })) return { outcome: "taken" };
	return { outcome: "failed", error: `npm stage publish exited ${status}` };
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
	console.log("\nConsumer typecheck acceptance...\n");
	run("node", ["npm-scripts/check-consumer-typecheck.mjs"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

if (!dryRun)
	console.log(`\nStaging with npm ${run("npm", ["--version"]).trim()}\n`);

const packages = publishablePackages(repoRoot);
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

	const unreleased = latest === null || latest.startsWith("0.0.0-");
	if (!unreleased && publishedContentHash(pkg.name, latest) === fresh) {
		summary.push({ name: pkg.name, decision: `skip (identical to ${latest})` });
		continue;
	}
	const target = unreleased ? "0.0.1" : patchBump(latest);
	const plan = unreleased
		? `seed ${target} (not on registry)`
		: `stage ${latest} -> ${target}`;

	if (dryRun) {
		summary.push({ name: pkg.name, decision: plan });
		packCheck(pkg.dir);
		continue;
	}
	setVersion(pkg.dir, target);
	const { outcome, error } = stage(pkg.dir);
	if (outcome === "failed")
		failures.push({ name: pkg.name, version: target, error });
	summary.push({
		name: pkg.name,
		decision:
			outcome === "taken"
				? `skip (${target} already staged, awaiting approval)`
				: `${plan}${outcome === "failed" ? " failed" : ""}`,
	});
}

console.log(`\n${dryRun ? "Dry run" : "Stage"} decisions:`);
for (const { name, decision } of summary) console.log(`  ${name}: ${decision}`);

if (failures.length > 0) {
	console.error("\nStage failures:");
	for (const f of failures)
		console.error(`  ${f.name}@${f.version}: ${f.error}`);
	process.exit(1);
}
