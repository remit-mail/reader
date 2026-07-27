// Every file the compose stack bind-mounts from the deployment directory has to
// be one install.sh puts there. The two lists are written in different files and
// nothing else connects them, so a new bind mount installs as a half-finished
// deployment: install.sh fails partway through fetch_assets, after it has
// already written some of the directory.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");
const INSTALL = readFileSync(join(ROOT, "install.sh"), "utf8");

// The ASSETS=( ... ) array, minus comments and quotes.
function installedAssets(source) {
	const block = source.match(/^ASSETS=\(\n([\s\S]*?)^\)/m);
	assert.ok(block, "install.sh has no ASSETS array");
	return block[1]
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => line.replace(/^"|"$/g, ""));
}

// `- ./path:/in/container[:ro]` under any service's volumes. The source may
// carry a `${VAR:-default}`, whose own colon would split the entry in the wrong
// place — resolve it to the default first, which is the file a stock install
// gets. The variants are covered by the other half of this suite, which asserts
// every installed asset exists.
function relativeBindSources(source) {
	return [...source.matchAll(/^ {6}- \.\/(\S+)$/gm)]
		.map((match) => match[1].replace(/\$\{[A-Z_]+:-([^}]*)\}/g, "$1"))
		.map((entry) => entry.split(":")[0]);
}

const assets = installedAssets(INSTALL);
const composeFiles = ["docker-compose.sqlite.yml"];

describe("install.sh installs every file the stack mounts", () => {
	for (const file of composeFiles) {
		const binds = [
			...new Set(relativeBindSources(readFileSync(join(DEPLOY, file), "utf8"))),
		];

		it(`${file} declares at least one relative bind`, () => {
			assert.ok(binds.length > 0, "expected the bind mounts to be parsed");
		});

		for (const bind of binds) {
			it(`installs ${bind}`, () => {
				assert.ok(
					assets.includes(bind),
					`${file} mounts ./${bind}, which install.sh's ASSETS does not fetch — the daemon would create a directory there`,
				);
			});
		}
	}

	for (const asset of assets) {
		it(`ships ${asset} in the repository`, () => {
			assert.ok(
				existsSync(join(DEPLOY, asset)),
				`install.sh fetches ${asset}, which does not exist under deploy/vps`,
			);
		});
	}
});
