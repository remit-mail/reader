#!/usr/bin/env node
// Writes deploy/updates/stable.json for a released tag (RFC 037 D3). Refuses
// unless the GitHub release for that tag already exists: image pushes are not
// atomic across the roster (see npm-scripts/release-check-tag.sh in #118), so
// only the release object — created last, after every image lands — says a
// version is fully published. `gh release view` below is the only existence
// check this script makes; it never looks at a registry or an image tag.
//
// Usage: npm run manifest:write -- vX.Y.Z
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateManifestSchema } from "@remit/data-ports/update-manifest";
import { assertValidVersion, extractSummary } from "./lib/update-manifest.mjs";

const REGISTRY = "ghcr.io/remit-mail/reader";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version) {
	console.error("usage: write-update-manifest.mjs vX.Y.Z");
	process.exit(1);
}

try {
	assertValidVersion(version);
} catch (error) {
	console.error(`manifest: ${error.message}`);
	process.exit(1);
}

let release;
try {
	const raw = execFileSync(
		"gh",
		["release", "view", version, "--json", "publishedAt,url,tagName"],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	release = JSON.parse(raw);
} catch {
	console.error(
		`manifest: no GitHub release found for ${version}; refusing to write the manifest until one exists`,
	);
	process.exit(1);
}

let tagMessage;
try {
	tagMessage = execFileSync(
		"git",
		["for-each-ref", "--format=%(contents:subject)", `refs/tags/${version}`],
		{ cwd: repoRoot, encoding: "utf8" },
	);
} catch (error) {
	console.error(
		`manifest: could not read the tag message for ${version}: ${error.message}`,
	);
	process.exit(1);
}

let summary;
try {
	summary = extractSummary(tagMessage);
} catch (error) {
	console.error(`manifest: ${error.message}`);
	process.exit(1);
}

const manifest = UpdateManifestSchema.parse({
	version,
	publishedAt: release.publishedAt,
	summary,
	releaseNotesUrl: release.url,
	registry: REGISTRY,
});

const outPath = join(repoRoot, "deploy/updates/stable.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, "\t")}\n`);

console.log(`manifest: wrote ${outPath} for ${version}`);
