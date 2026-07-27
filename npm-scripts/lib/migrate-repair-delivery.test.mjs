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

	// The real guard against a compose-level delivery is the pair of dialect-path
	// assertions above: if the repair moved out of this entrypoint they fail,
	// whatever it were renamed to. This adds the one thing they cannot see — that
	// no compose file gained a second way to invoke the migrate image, which is the
	// shape the rejected design had. It names the module and the flag rather than
	// the word "repair", so a service called `category-fix` is caught and a comment
	// mentioning "repaired" is not.
	it("no compose file invokes the entrypoint a second way", () => {
		for (const file of [
			["deploy", "vps", "docker-compose.sqlite.yml"],
			["deploy", "vps", "docker-compose.e2e.yml"],
			["deploy", "vps", "docker-compose.dovecot.yml"],
			["docker-compose.localhost-dev-generic.yml"],
		]) {
			const compose = read(...file);
			for (const smell of [
				"thread-message-category",
				"--check",
				"migrate.mjs ",
			]) {
				assert.ok(
					!compose.includes(smell),
					`${file.join("/")} carries "${smell}" — a repair a compose file has to invoke reaches nobody already installed`,
				);
			}
		}
	});

	// The steady state is zero divergence, and SQLite takes its exclusive write
	// lock when an UPDATE begins — before it can know the WHERE matches nothing. An
	// unconditional statement would contend for that lock on every boot of a
	// healthy instance, and losing it fails the migration and holds the app plane
	// down.
	it("issues no write when the check found nothing to repair", () => {
		assert.match(RUN_MIGRATE, /report\.repairable === 0/);
		assert.match(RUN_MIGRATE, /formatRepairSkipped\(report\)/);
	});

	// `compose run` starts the service's dependencies unless told not to, and
	// migrate depends on volume-init, which chowns the data volumes as root. A
	// read-only report must not do that on the operator's behalf.
	it("is reachable through the wrapper without starting a dependency", () => {
		const wrapper = read("deploy", "vps", "remit");
		assert.match(wrapper, /check-categories\) cmd_check_categories/);
		assert.match(
			wrapper,
			/compose run --rm --no-deps migrate node migrate\.mjs --check/,
		);
	});
});
