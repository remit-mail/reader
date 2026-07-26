// How the `thread_message.category` repair reaches an instance (#321, D16).
//
// The repair is only correct if it runs everywhere, and `remit update` moves an
// image tag and runs `compose pull` against the compose file already on disk —
// it downloads no deploy assets, and the repository-root install.sh is the only
// thing that ever fetches docker-compose.sqlite.yml (#281). So the image is the
// one artefact an update delivers, and a repair placed in compose reaches nobody
// who is already installed.
//
// These assertions are the guard D16 names: the repair is inside the migrate
// entrypoint that the image already carries, on both dialect paths, and it is
// nowhere in any compose file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const RUN_MIGRATE = read("deploy", "vps", "migrate", "run-migrate.ts");
const REPAIR_CALL = "repairThreadMessageCategoryStep(";

function section(source, from, to) {
	const start = source.indexOf(from);
	assert.notEqual(start, -1, `${from} not found in run-migrate.ts`);
	const end = source.indexOf(to, start);
	assert.notEqual(end, -1, `${to} not found after ${from}`);
	return source.slice(start, end);
}

describe("the category repair ships inside the migrate entrypoint", () => {
	it("runs on the sqlite path", () => {
		const sqlite = section(
			RUN_MIGRATE,
			"const runSqlite = async",
			"const run = async",
		);
		assert.ok(
			sqlite.includes(REPAIR_CALL),
			"runSqlite must run the repair: sqlite is the backend every self-host instance uses",
		);
	});

	it("runs on the postgres path", () => {
		const postgres = section(
			RUN_MIGRATE,
			"const runPostgres = async",
			"const runSqlite = async",
		);
		assert.ok(
			postgres.includes(REPAIR_CALL),
			"runPostgres must run the repair too, or a Postgres instance upgrades onto a stale column",
		);
	});

	it("takes --check and refuses any other argument", () => {
		assert.match(RUN_MIGRATE, /argv\[0\] === "--check"/);
		assert.match(RUN_MIGRATE, /unrecognised argument/);
	});

	it("no longer claims it never rewrites row content", () => {
		assert.ok(
			!RUN_MIGRATE.includes("It does not rewrite row content"),
			"the header has to be amended where it stopped being true, not left to mislead",
		);
	});

	it("is bundled into the backend image as migrate.mjs", () => {
		const bundle = read("npm-scripts", "docker-bundle.mjs");
		assert.match(bundle, /deploy\/vps\/migrate\/run-migrate\.ts/);
		assert.match(bundle, /dist-docker\/backend\/migrate\.mjs/);
		assert.match(read("Dockerfile"), /migrate\.mjs \.\/migrate\.mjs/);
	});

	it("is invoked by the migrate one-shot the app plane already gates on", () => {
		const compose = read("deploy", "vps", "docker-compose.sqlite.yml");
		assert.match(compose, /command: \["node", "migrate\.mjs"\]/);
		const gates = compose.match(
			/migrate:\s*\n\s*condition: service_completed_successfully/g,
		);
		assert.ok(
			gates && gates.length >= 6,
			`every app service must wait on the one-shot; found ${gates?.length ?? 0} gates`,
		);
	});

	// If the repair needs a compose change to run, it does not ship: an operator
	// who runs `remit update` would get the new client, the new server, and no
	// repair.
	it("appears in no compose file", () => {
		for (const file of [
			["deploy", "vps", "docker-compose.sqlite.yml"],
			["deploy", "vps", "docker-compose.e2e.yml"],
			["deploy", "vps", "docker-compose.dovecot.yml"],
			["docker-compose.localhost-dev-generic.yml"],
		]) {
			const compose = read(...file);
			assert.ok(
				!/repair/i.test(compose),
				`${file.join("/")} must not carry the repair`,
			);
		}
	});
});
