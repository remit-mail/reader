#!/usr/bin/env node
// Stamps the npm-publish metadata (MIT license, public access, repository
// directory) onto every workspace package the publish pipeline ships — the
// non-private packages that changesets does not ignore. Idempotent: re-run it
// after adding or reclassifying a package.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
	readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"),
);
const ignored = new Set(config.ignore ?? []);

const repository = "https://github.com/remit-mail/reader.git";

const workspaceDirs = readdirSync(join(repoRoot, "packages")).map((name) =>
	join("packages", name),
);

const detectIndent = (raw) => {
	const match = raw.match(/\n([\t ]+)"/);
	return match ? match[1] : "\t";
};

let stamped = 0;
let stripped = 0;
for (const dir of workspaceDirs) {
	const path = join(repoRoot, dir, "package.json");
	let manifest;
	let raw;
	try {
		raw = readFileSync(path, "utf8");
		manifest = JSON.parse(raw);
	} catch {
		continue;
	}

	const publishes = !manifest.private && !ignored.has(manifest.name);
	// Manage only the three publish markers. On strip, leave a pre-existing
	// license alone (a closed package may carry its own, e.g. UNLICENSED) and
	// remove only the access/repository markers the pipeline added.
	const wanted = publishes
		? {
				license: "MIT",
				publishConfig: { access: "public" },
				repository: { type: "git", url: `git+${repository}`, directory: dir },
			}
		: {
				license: manifest.license,
				publishConfig: undefined,
				repository: undefined,
			};
	const current = {
		license: manifest.license,
		publishConfig: manifest.publishConfig,
		repository: manifest.repository,
	};
	if (JSON.stringify(current) === JSON.stringify(wanted)) continue;

	manifest.license = wanted.license;
	manifest.publishConfig = wanted.publishConfig;
	manifest.repository = wanted.repository;

	const trailing = raw.endsWith("\n") ? "\n" : "";
	writeFileSync(path, JSON.stringify(manifest, null, detectIndent(raw)) + trailing);
	if (publishes) {
		stamped += 1;
		console.log(`stamped ${manifest.name}`);
	} else {
		stripped += 1;
		console.log(`stripped ${manifest.name}`);
	}
}

console.log(`\n${stamped} stamped, ${stripped} stripped.`);
