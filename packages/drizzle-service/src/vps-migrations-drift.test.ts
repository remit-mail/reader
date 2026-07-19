import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The migration-check script is stripped from the open-core tree; skip there and
// run where it ships.
const hasCheckScript = existsSync(
	resolve(repoRoot, "npm-scripts/check-vps-migrations.mjs"),
);

// Fails when the committed VPS migrations (deploy/vps/migrations/*) no longer
// produce the schema drizzle would generate from the entity + auth schemas.
// See npm-scripts/check-vps-migrations.mjs for the mechanism.
test("committed VPS migrations match the drizzle schema", {
	skip: !hasCheckScript,
}, () => {
	assert.doesNotThrow(() => {
		execFileSync("node", ["npm-scripts/check-vps-migrations.mjs", "--check"], {
			cwd: repoRoot,
			stdio: "inherit",
		});
	}, "committed VPS migrations are stale — run `npm run migrations:generate`");
});
