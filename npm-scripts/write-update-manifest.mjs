#!/usr/bin/env node
// Writes deploy/updates/stable.json for a released tag (RFC 037 D3). Refuses
// unless a GitHub release for that tag already exists: image pushes are not
// atomic across the roster (see npm-scripts/release-check-tag.sh in #118), so
// only the release object says a version is fully published. `gh release view`
// below is the only existence check this script makes; it never looks at a
// registry or an image tag.
//
// release.yml publishes this file as an asset of the release it is cutting, and
// must upload it before flipping the release out of draft — otherwise the
// published `releases/latest/download/stable.json` 404s for the window between
// the two. So it runs the script against that release while it is still a draft
// and passes --allow-draft. Without the flag a draft is refused, so a manual
// run never publishes a manifest for a half-cut or someone else's stray draft.
//
// Usage: npm run manifest:write -- vX.Y.Z [--allow-draft]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateManifestSchema } from "@remit/data-ports/update-manifest";
import {
	assertValidVersion,
	DEFAULT_REGISTRY,
	deriveSchemaVersion,
	readTagSummary,
} from "./lib/update-manifest.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFile = (cmd, args) =>
	execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });

async function main() {
	const args = process.argv.slice(2);
	const allowDraft = args.includes("--allow-draft");
	const version = args.find((arg) => !arg.startsWith("--"));
	if (!version) {
		console.error("usage: write-update-manifest.mjs vX.Y.Z [--allow-draft]");
		process.exit(1);
	}

	assertValidVersion(version);

	let release;
	try {
		const raw = execFile("gh", [
			"release",
			"view",
			version,
			"--json",
			"publishedAt,createdAt,url,tagName,isDraft,isPrerelease",
		]);
		release = JSON.parse(raw);
	} catch {
		console.error(
			`manifest: no GitHub release found for ${version}; refusing to write the manifest until one exists`,
		);
		process.exit(1);
	}

	if (release.isDraft && !allowDraft) {
		console.error(
			`manifest: ${version} is a draft release; refusing until it is published`,
		);
		process.exit(1);
	}

	if (release.isPrerelease) {
		console.error(
			`manifest: ${version} is marked a pre-release; refusing to offer it as the stable update`,
		);
		process.exit(1);
	}

	const summary = readTagSummary(version, { execFile });

	// A draft has no publishedAt yet; it is set when release.yml flips the draft
	// out moments later, so createdAt is the same release cut to the minute.
	const manifest = UpdateManifestSchema.parse({
		version,
		publishedAt: release.publishedAt ?? release.createdAt,
		summary,
		releaseNotesUrl: release.url,
		registry: DEFAULT_REGISTRY,
		schemaVersion: deriveSchemaVersion(repoRoot),
	});

	const outPath = join(repoRoot, "deploy/updates/stable.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(manifest, null, "\t")}\n`);

	console.log(`manifest: wrote ${outPath} for ${version}`);
}

main().catch((error) => {
	console.error(`manifest: ${error.message}`);
	process.exit(1);
});
