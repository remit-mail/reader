import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Fails when the committed VPS migrations (deploy/vps/migrations/*) no longer
// produce the schema drizzle would generate from the entity + auth schemas.
// See npm-scripts/check-vps-migrations.mjs for the mechanism.
test("committed VPS migrations match the drizzle schema", () => {
	assert.doesNotThrow(() => {
		execFileSync("node", ["npm-scripts/check-vps-migrations.mjs", "--check"], {
			cwd: repoRoot,
			stdio: "inherit",
		});
	}, "committed VPS migrations are stale — run `npm run migrations:generate`");
});
