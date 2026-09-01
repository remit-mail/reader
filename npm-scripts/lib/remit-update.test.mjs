// The self-update sequence in deploy/vps/remit (RFC 037 D5, D6, D6a, D6b).
//
// Driven end to end against a docker stand-in (remit-test/fake-docker.sh), so
// what is asserted is the wrapper's real control flow: the order the steps run
// in, what it writes to .env and to its own volume, and which verdict it
// reaches. The ordering assertions are the point — a sequence that takes the
// snapshot after the stop, or writes the tag at commit, passes every
// per-function test and is still wrong.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const SNAPSHOT_LIB = join(ROOT, "deploy", "vps", "backup", "snapshot-db.sh");
const FAKES = join(HERE, "remit-test");
const SQLITE_SHIM = join(FAKES, "sqlite3-shim.mjs");

// Taken from the template verbatim: the value is `${TLS_MODE:-}`, and a sandbox
// that pre-resolves it writes an .env no operator has.
const COMPOSE_PROFILES_LINE =
	readFileSync(join(ROOT, "deploy", "vps", "remit.env.template"), "utf8")
		.split("\n")
		.find((line) => line.startsWith("COMPOSE_PROFILES=")) ?? "";

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const MANIFEST = {
	version: "v1.5.0",
	publishedAt: "2026-07-18T09:00:00Z",
	summary: "Faster search and a fix for attachments over 25 MB.",
	releaseNotesUrl: "https://github.com/remit-mail/reader/releases/tag/v1.5.0",
	registry: "ghcr.io/remit-mail/reader",
};

// The seam's requests carry the time they were made and are only installed
// while they are still current (#587), so a fixture's timestamp is part of what
// it tests: a hardcoded one rots into an expired request the moment the date
// passes it.
const justNow = () => new Date().toISOString();
const agedBy = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

const ALL_SERVICES =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker search-index-worker";

// The always-on stack the shipped compose file declares — every service with no
// `profiles:` key. `search-index-worker` is not one of them: it sits behind the
// `semantic` profile and only runs where an operator asked for vector search
// (issue #1068), so an update on a stopped box brings it back no more than it
// brings back the tunnel agent or the metrics containers. The stand-in answers `config --services` from that file, so
// this is the list the wrapper derives its held-back set from, and "the whole
// always-on stack" means this rather than whatever a sandbox happens to seed.
// A service added to the deployment fails the check that compares the two.
const COMPOSE_ALWAYS_ON = [
	"account-worker",
	"apisix",
	"backend",
	"caddy",
	"doctor",
	"imap-worker",
	"migrate",
	"queue",
	"scheduler",
	"smtp-worker",
	"updater",
	"volume-init",
	"web",
];

// What is serving once that stack is up: the updater drives the update and
// replaces itself last, and migrate and volume-init exit as soon as they finish.
const WHOLE_STACK = COMPOSE_ALWAYS_ON.filter(
	(service) => !["migrate", "updater", "volume-init"].includes(service),
);

// A real remit.db at schema total 8 (6 entity migrations, 1 auth, 1 meta), the
// tables named exactly as the migrate one-shot writes them, so the wrapper's own
// schema read and the fake migrate operate on the layout production runs.
function seedDatabase(path) {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("CREATE TABLE message (id INTEGER PRIMARY KEY, subject TEXT)");
	db.exec("INSERT INTO message VALUES (1, 'hello')");
	for (const [table, rows] of [
		["__drizzle_migrations_entities", 6],
		["__drizzle_migrations_auth", 1],
		["__drizzle_migrations_meta", 1],
	]) {
		db.exec(
			`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER)`,
		);
		for (let i = 0; i < rows; i += 1) {
			db.exec(`INSERT INTO ${table} VALUES (${i}, 'h${i}', ${i})`);
		}
	}
	db.close();
}

// A remit.db that exists but has none of the drizzle bookkeeping tables: the
// window before the migrate one-shot has run, where every migration table
// count falls through the sqlite3 fallback to 0. The instance is at schema 0,
// not unknown.
function seedBareDatabase(path) {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("CREATE TABLE message (id INTEGER PRIMARY KEY, subject TEXT)");
	db.close();
}

function schemaTotal(dbPath) {
	const db = new DatabaseSync(dbPath);
	let total = 0;
	for (const table of [
		"__drizzle_migrations_entities",
		"__drizzle_migrations_auth",
		"__drizzle_migrations_meta",
	]) {
		const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}`).get();
		total += n;
	}
	db.close();
	return total;
}

function hasFilterMoveColumn(dbPath) {
	const db = new DatabaseSync(dbPath);
	const columns = db.prepare("PRAGMA table_info(message)").all();
	db.close();
	return columns.some((c) => c.name === "filter_move");
}

function messageSubjects(dbPath) {
	const db = new DatabaseSync(dbPath);
	const rows = db.prepare("SELECT subject FROM message ORDER BY id").all();
	db.close();
	return rows.map((r) => r.subject);
}

// The live database as a host reboot after the commit finds it: the release's
// migration applied, and a message the running instance wrote afterwards.
function applyMigrationAndWrite(dbPath, subject) {
	const db = new DatabaseSync(dbPath);
	db.exec("ALTER TABLE message ADD COLUMN filter_move text");
	db.exec(
		"INSERT INTO __drizzle_migrations_entities (id, hash, created_at) VALUES (99, 'applied', 99)",
	);
	db.prepare("INSERT INTO message (id, subject) VALUES (2, ?)").run(subject);
	db.close();
}

// The pair of flat files a completed update leaves wherever its STATE_DIR was:
// what it did, and what the check before it found.
function writeRecord(dir, { outcome, message, latestVersion, lastCheckedAt }) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "run.json"),
		`${JSON.stringify({
			runId: `${lastCheckedAt}-run`,
			fromVersion: "v0.2.15",
			targetVersion: latestVersion,
			phase: "committing",
			outcome,
			startedAt: lastCheckedAt,
			updatedAt: lastCheckedAt,
			message,
			logCommand: "remit logs updater",
		})}\n`,
	);
	writeFileSync(
		join(dir, "check.json"),
		`${JSON.stringify({
			status: "ok",
			lastCheckedAt,
			latestVersion,
			updateAvailable: false,
		})}\n`,
	);
}

function writeExecutable(path, body) {
	writeFileSync(path, body);
	spawnSync("chmod", ["+x", path]);
}

// The wrapper as it reaches a box: the release's own file with the three lines
// install.sh's place_wrapper rewrites pointed at this deployment. An update
// that installs the release's wrapper has to stamp it the same way, so this is
// both what a sandbox starts with and what its result is measured against.
const WRAPPER_SOURCE = readFileSync(REMIT, "utf8");

function stampWrapper(source, { dir, composeFile, prog }) {
	return source
		.replace(/^DEFAULT_DIR=.*$/m, `DEFAULT_DIR=${dir}`)
		.replace(/^COMPOSE_FILE=.*$/m, `COMPOSE_FILE=${composeFile}`)
		.replace(/^PROG=.*$/m, `PROG=${prog}`);
}

function sandbox({
	scenario = {},
	manifest = MANIFEST,
	env = {},
	dotenv = [],
	realDb = false,
	bareDb = false,
	tag = "v1.0.0",
	tlsMode = "internal",
	// The release's host-side files, served from the tag the run installs
	// (reader#1072). Unset, the release ships what this checkout ships, which is
	// a release that changed neither file. `hostAssets: false` is the release
	// whose files cannot be fetched at all.
	hostAssets = true,
	releaseWrapper = null,
	releaseCompose = null,
	installedWrapper = null,
	prog = "remit",
	// An operator at a host shell, where REMIT_UPDATE_STATE_DIR is unset and
	// STATE_DIR falls back to the directory beside .env. Every other test sets
	// it, which is what kept the divergence between that directory and the
	// updater's volume out of the suite (reader#573).
	operatorShell = false,
} = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-update-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const state = join(dir, "state");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	const sqlite = join(dir, "sqlite");
	// A host directory standing in for the updater_state volume, the way sqlite
	// stands in for sqlite_data.
	const updaterState = join(dir, "updater-state");
	for (const d of [
		deployment,
		join(deployment, "backup"),
		state,
		fake,
		bin,
		sqlite,
		updaterState,
	]) {
		mkdirSync(d, { recursive: true });
	}
	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	copyFileSync(SNAPSHOT_LIB, join(deployment, "backup", "snapshot-db.sh"));
	writeExecutable(
		join(deployment, "remit"),
		typeof installedWrapper === "function"
			? installedWrapper(deployment)
			: (installedWrapper ??
					stampWrapper(WRAPPER_SOURCE, {
						dir: deployment,
						composeFile: "docker-compose.sqlite.yml",
						prog,
					})),
	);
	if (hostAssets) {
		mkdirSync(join(fake, "assets"), { recursive: true });
		writeFileSync(
			join(fake, "assets", "remit"),
			releaseWrapper ?? WRAPPER_SOURCE,
		);
		writeFileSync(
			join(fake, "assets", "docker-compose.sqlite.yml"),
			releaseCompose ?? readFileSync(COMPOSE, "utf8"),
		);
	}
	writeFileSync(
		join(deployment, ".env"),
		[
			`REMIT_TAG=${tag}`,
			"PUBLIC_ORIGIN=https://mail.example.test",
			// The deployment directory the compose file demands and install.sh
			// writes. The stand-in resolves interpolations now, so an .env without
			// it is an .env no `docker compose config` would accept.
			`REMIT_DEPLOY_DIR=${deployment}`,
			`TLS_MODE=${tlsMode}`,
			// Compose reads its active profiles from here, so the mode is what turns
			// the tunnel agent on — not a scenario key.
			COMPOSE_PROFILES_LINE,
			"REMIT_UPDATE_MANIFEST_URL=https://updates.example.test/stable.json",
			...dotenv,
			"",
		].join("\n"),
	);

	const services = scenario.services ?? ALL_SERVICES;
	writeFileSync(
		join(fake, "scenario"),
		Object.entries({ ...scenario, services })
			.map(([k, v]) => `${k}=${v}`)
			.join("\n"),
	);
	if (manifest) {
		writeFileSync(join(fake, "manifest"), JSON.stringify(manifest));
	}
	// A live stack: every service has a container, every container is up, and
	// each was started from the deployment as it stands on disk — so the next
	// `up` recreates only what a change to .env or the compose file moves.
	let seq = 0;
	// filter(Boolean): a scenario with no services at all is a box that is down,
	// and an empty name would seed a container for a service that does not exist.
	for (const svc of `${services} migrate`.split(" ").filter(Boolean)) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		if (svc !== "migrate") writeFileSync(join(fake, `up-${svc}`), "");
		copyFileSync(join(deployment, ".env"), join(fake, `env-seen-${svc}`));
		copyFileSync(
			join(deployment, "docker-compose.sqlite.yml"),
			join(fake, `compose-seen-${svc}`),
		);
	}
	writeFileSync(join(fake, "seq"), String(seq));

	for (const [name, src] of [
		["docker", "fake-docker.sh"],
		["curl", "fake-curl.sh"],
	]) {
		const dest = join(bin, name);
		copyFileSync(join(FAKES, src), dest);
		spawnSync("chmod", ["+x", dest]);
	}

	// Real-database mode: the helper containers run their scripts for real, so
	// the tools they call inside the container are shimmed onto PATH — sqlite3 is
	// node:sqlite, su-exec drops its uid argument and execs, apk and chown are
	// no-ops (the sandbox is one uid, and there is no package index to hit).
	if (realDb) {
		(bareDb ? seedBareDatabase : seedDatabase)(join(sqlite, "remit.db"));
		writeExecutable(
			join(bin, "sqlite3"),
			`#!/bin/sh\nexec node "${SQLITE_SHIM}" "$@"\n`,
		);
		writeExecutable(join(bin, "su-exec"), '#!/bin/sh\nshift\nexec "$@"\n');
		writeExecutable(join(bin, "apk"), "#!/bin/sh\nexit 0\n");
		writeExecutable(join(bin, "chown"), "#!/bin/sh\nexit 0\n");
	}

	const baseEnv = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
		...(operatorShell ? {} : { REMIT_UPDATE_STATE_DIR: state }),
		REMIT_UPDATE_STATE_VOLUME: updaterState,
		// The asset base shares the manifest URL's origin, which is what a
		// deployment that has not gone out of its way to say otherwise is held to.
		REMIT_UPDATE_ASSET_BASE:
			"https://updates.example.test/remit-mail/reader/@TAG@/deploy/vps",
		REMIT_UPDATE_GATE_BUDGET: "2",
		REMIT_UPDATE_PROBE_INTERVAL: "0",
		...(realDb
			? {
					FAKE_REAL_DB: "1",
					FAKE_SQLITE_DIR: sqlite,
					REMIT_UPDATE_SQLITE_VOLUME: sqlite,
				}
			: {}),
		...env,
	};

	const liveDb = join(sqlite, "remit.db");
	return {
		dir,
		deployment,
		state,
		updaterState,
		fake,
		sqlite,
		liveDb,
		env: baseEnv,
		liveSchema() {
			return schemaTotal(liveDb);
		},
		liveHasFilterMove() {
			return hasFilterMoveColumn(liveDb);
		},
		liveBytes() {
			return readFileSync(liveDb);
		},
		snapshotDb() {
			const snapDir = join(state, "snapshots");
			const runs = readdirSync(snapDir);
			assert.equal(runs.length, 1, `expected one snapshot, saw ${runs.length}`);
			return join(snapDir, runs[0], "remit.db");
		},
		run(args, extra = {}) {
			return spawnSync("sh", [REMIT, ...args], {
				env: { ...baseEnv, ...extra },
				encoding: "utf8",
			});
		},
		dotenv(key) {
			const line = readFileSync(join(deployment, ".env"), "utf8")
				.split("\n")
				.find((l) => l.startsWith(`${key}=`));
			return line ? line.slice(key.length + 1) : null;
		},
		stateJson() {
			return JSON.parse(readFileSync(join(state, "state.json"), "utf8"));
		},
		log() {
			try {
				return readFileSync(join(fake, "log"), "utf8");
			} catch {
				return "";
			}
		},
		// The services the run left up, read from the stand-in's own state — the
		// same markers `compose ps --status running` answers from, so this is the
		// end state an operator's stack would be in.
		running() {
			return readdirSync(fake)
				.filter((f) => f.startsWith("up-"))
				.map((f) => f.slice("up-".length))
				.sort();
		},
		volumeScripts() {
			try {
				return readFileSync(join(fake, "volume-scripts"), "utf8");
			} catch {
				return "";
			}
		},
		// The host-side files as the deployment carries them now, and the URLs
		// the run asked the release for.
		installedWrapper() {
			return readFileSync(join(deployment, "remit"), "utf8");
		},
		installedCompose() {
			return readFileSync(
				join(deployment, "docker-compose.sqlite.yml"),
				"utf8",
			);
		},
		assetLog() {
			try {
				return readFileSync(join(fake, "asset-log"), "utf8");
			} catch {
				return "";
			}
		},
		snapshotDirs() {
			try {
				return readdirSync(join(state, "snapshots")).sort();
			} catch {
				return [];
			}
		},
		seedSnapshots(names, mode) {
			mkdirSync(join(state, "snapshots"), { recursive: true });
			for (const name of names) {
				mkdirSync(join(state, "snapshots", name), { recursive: true });
			}
			if (mode !== undefined) chmodSync(join(state, "snapshots"), mode);
		},
		breadcrumb() {
			return readFileSync(join(state, "breadcrumb"), "utf8");
		},
		writeBreadcrumb(fields) {
			writeFileSync(
				join(state, "breadcrumb"),
				`${Object.entries(fields)
					.map(([k, v]) => `${k}=${v}`)
					.join("\n")}\n`,
			);
		},
	};
}

const orderOf = (log, needle) =>
	log.split("\n").findIndex((line) => line.includes(needle));

// What `docker compose config --services` answers in a sandbox, read straight
// from the stand-in rather than through the wrapper.
function composeServices(box, flags = []) {
	const run = spawnSync(
		join(box.dir, "bin", "docker"),
		[
			"compose",
			"--project-directory",
			box.deployment,
			"-f",
			join(box.deployment, "docker-compose.sqlite.yml"),
			"--env-file",
			join(box.deployment, ".env"),
			...flags,
			"config",
			"--services",
		],
		{ env: box.env, encoding: "utf8" },
	);
	assert.equal(run.status, 0, run.stderr);
	return run.stdout.split("\n").filter(Boolean).sort();
}

// The premise every assertion below about "the whole stack" rests on. A list
// written into the stand-in is the deployment's stack only until someone adds a
// service to the compose file, and then it silently is not: the update suite
// asserted a nine-name stack against a fourteen-service deployment for as long
// as that list was written out (reader#786).
describe("the stand-in's service list is the compose file's", () => {
	it("lists what the deployment declares, not a list of its own", () => {
		const box = sandbox();
		assert.deepEqual(composeServices(box), [...COMPOSE_ALWAYS_ON].sort());
	});

	it("hides a service behind an inactive profile, the way compose does", () => {
		const box = sandbox();
		for (const service of [
			"tunnel",
			"backup",
			"dozzle",
			"victoriametrics",
			"search-index-worker",
		]) {
			assert.ok(
				!composeServices(box).includes(service),
				`${service} is listed on a deployment whose profile is off`,
			);
		}
	});

	it("lists one whose profile COMPOSE_PROFILES names", () => {
		const box = sandbox({ tlsMode: "tunnel" });
		assert.deepEqual(
			composeServices(box),
			[...COMPOSE_ALWAYS_ON, "tunnel"].sort(),
		);
	});

	it("lists every service under --profile '*'", () => {
		const box = sandbox();
		assert.deepEqual(
			composeServices(box, ["--profile", "*"]),
			[
				...COMPOSE_ALWAYS_ON,
				"backup",
				"dozzle",
				"search-index-worker",
				"tunnel",
				"victoriametrics",
			].sort(),
		);
	});
});

describe("remit update — the happy path", () => {
	const box = sandbox({ scenario: { probe: "ok", migrate_exit: 0 } });
	const result = box.run(["update"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("leaves .env on the new tag", () => {
		assert.equal(box.dotenv("REMIT_TAG"), "v1.5.0");
	});

	it("takes the snapshot before anything is stopped", () => {
		const log = box.log();
		assert.ok(orderOf(log, "run snapshot") >= 0, "no snapshot was taken");
		assert.ok(orderOf(log, "run snapshot") < orderOf(log, "compose stop"));
	});

	it("writes the tag before the stop, not at commit", () => {
		// The .env write leaves no trace in the docker log, so the breadcrumb's
		// own ordering is what proves it: the phase reached `stopping` only
		// after set_var, and the stop follows the phase.
		const log = box.log();
		assert.ok(
			orderOf(log, "compose stop") <
				orderOf(log, "compose up -d queue migrate backend"),
		);
	});

	it("starts a gate set that serves nobody", () => {
		assert.ok(box.log().includes("compose up -d queue migrate backend"));
	});

	it("brings the held-back services back on commit", () => {
		const commit = box
			.log()
			.split("\n")
			.filter((l) => l.startsWith("compose up -d ") && l.includes("apisix"));
		assert.equal(commit.length, 1);
		assert.ok(commit[0].includes("web"));
		assert.ok(commit[0].includes("search-index-worker"));
	});

	it("clears the breadcrumb once the outcome is terminal", () => {
		assert.throws(() => box.breadcrumb());
	});

	it("keeps this run's snapshot and reports a pasteable command", () => {
		const run = box.stateJson().run;
		assert.equal(run.logCommand, "remit logs backend");
		assert.match(run.message, /v1\.5\.0/);
	});
});

describe("remit update — the migration fails", () => {
	const box = sandbox({
		scenario: { migrate_exit: 1, migrate_exit2: 0, probe: "ok" },
	});
	const result = box.run(["update"]);

	it("rolls back", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
	});

	it("puts .env back on the previous tag", () => {
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
	});

	it("names the migration in the message the operator is shown", () => {
		assert.match(box.stateJson().run.message, /migration failed \(exit 1\)/);
	});

	it("restores the snapshot", () => {
		assert.ok(box.log().includes("run restore"));
	});
});

describe("remit update — the new version never answers", () => {
	const box = sandbox({ scenario: { probe: "fail", probe2: "ok" } });
	const started = Date.now();
	const result = box.run(["update"]);
	const elapsedMs = Date.now() - started;

	it("rolls back inside the budget plus a margin", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.ok(elapsedMs < 30_000, `rollback took ${elapsedMs}ms`);
	});

	it("says the backend did not answer", () => {
		assert.match(box.stateJson().run.message, /did not answer/);
	});
});

describe("remit update — the rollback's own gate fails", () => {
	const box = sandbox({ scenario: { probe: "fail", probe2: "fail" } });
	box.run(["update"]);

	it("terminates rollbackFailed and names the snapshot", () => {
		const run = box.stateJson().run;
		assert.equal(run.outcome, "rollbackFailed");
		assert.match(run.message, /snapshot/);
		assert.equal(run.logCommand, "remit logs backend");
	});
});

// reader#1072. A release is not only its images. The wrapper and the compose
// file are host files, and an update that moves the images and leaves those two
// where they were gives the operator a box whose commands and whose service
// definitions belong to the version before it: a verb the release adds
// answering `unknown command`, a profile its compose file never declares.
//
// The wrapper stand-ins are deliberately tiny. What is being asserted is that
// the file the deployment carries afterwards is the release's and answers the
// release's commands, and a real wrapper would prove that no better while
// costing every assertion a 3000-line diff to read.
const wrapperWith = (verbs) =>
	[
		"#!/bin/sh",
		"DEFAULT_DIR=/opt/remit",
		"COMPOSE_FILE=docker-compose.sqlite.yml",
		"PROG=remit",
		'case "${1:-}" in',
		...verbs.map((verb) => `${verb}) printf '${verb}\\n' ;;`),
		"*) printf 'unknown command\\n' >&2; exit 1 ;;",
		"esac",
		"",
	].join("\n");

// The release adds a verb to the wrapper, an always-on service to the compose
// file, and a service behind a profile the previous release never declared —
// the three shapes #1072 was observed in.
const RELEASE_WRAPPER = wrapperWith(["doctor", "semantic"]);
const RELEASE_COMPOSE = readFileSync(COMPOSE, "utf8").replace(
	/^services:$/m,
	[
		"services:",
		"  search-preview:",
		"    image: ghcr.io/remit-mail/reader/web:${REMIT_TAG:-latest}",
		"  semantic-indexer:",
		'    profiles: ["semantic"]',
		"    image: ghcr.io/remit-mail/reader/web:${REMIT_TAG:-latest}",
	].join("\n"),
);

// What this deployment has installed: the previous release's wrapper, stamped
// the way install.sh stamps it, on a second deployment so the name and the
// directory are things a re-stamp can lose.
const installedFor = (dir) =>
	stampWrapper(wrapperWith(["doctor"]), {
		dir,
		composeFile: "docker-compose.sqlite.yml",
		prog: "remit-blue",
	});

const wrapperAnswers = (box, verb) =>
	spawnSync(join(box.deployment, "remit"), [verb], { encoding: "utf8" }).status;

describe("remit update — the release's wrapper and compose file", () => {
	const box = sandbox({
		scenario: { probe: "ok", migrate_exit: 0 },
		releaseWrapper: RELEASE_WRAPPER,
		releaseCompose: RELEASE_COMPOSE,
		installedWrapper: installedFor,
	});
	const result = box.run(["update"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("fetches both files from the release being installed", () => {
		const asked = box.assetLog();
		assert.match(asked, /\/v1\.5\.0\/deploy\/vps\/remit$/m);
		assert.match(
			asked,
			/\/v1\.5\.0\/deploy\/vps\/docker-compose\.sqlite\.yml$/m,
		);
	});

	it("leaves the deployment carrying the release's commands", () => {
		assert.equal(wrapperAnswers(box, "semantic"), 0);
	});

	it("re-stamps it with this deployment's own values", () => {
		const lines = box.installedWrapper().split("\n");
		assert.ok(lines.includes(`DEFAULT_DIR=${box.deployment}`));
		assert.ok(lines.includes("COMPOSE_FILE=docker-compose.sqlite.yml"));
		assert.ok(lines.includes("PROG=remit-blue"));
	});

	it("leaves the compose file declaring the release's services", () => {
		assert.ok(composeServices(box).includes("search-preview"));
		assert.ok(
			composeServices(box, ["--profile", "*"]).includes("semantic-indexer"),
		);
	});
});

describe("remit update — the gate fails on the release's own files", () => {
	const box = sandbox({
		scenario: { probe: "fail", probe2: "ok" },
		releaseWrapper: RELEASE_WRAPPER,
		releaseCompose: RELEASE_COMPOSE,
		installedWrapper: installedFor,
	});
	const wasInstalled = installedFor(box.deployment);
	const result = box.run(["update"]);

	it("rolls back", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
	});

	// The gate is a verdict on what will run, so the release's compose file is
	// what the stack was verified against: the stop that begins the rollback
	// enumerates services the previous release never declared.
	it("verified the release against the release's compose file", () => {
		assert.ok(box.log().includes("search-preview"));
	});

	it("puts the deployment's own wrapper back", () => {
		assert.equal(box.installedWrapper(), wasInstalled);
		assert.notEqual(wrapperAnswers(box, "semantic"), 0);
	});

	it("puts the deployment's own compose file back", () => {
		assert.equal(box.installedCompose(), readFileSync(COMPOSE, "utf8"));
		assert.ok(!composeServices(box).includes("search-preview"));
	});
});

describe("remit update — the release's host-side files cannot be fetched", () => {
	const box = sandbox({
		scenario: { probe: "ok", migrate_exit: 0 },
		hostAssets: false,
	});
	const result = box.run(["update"]);

	it("abandons the run rather than installing half a release", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.match(box.stateJson().run.message, /wrapper and compose file/);
	});

	it("changes nothing", () => {
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose stop"));
	});
});

// A fetch that completed proves bytes arrived and nothing else. Both files are
// read next by something that cannot report a failure — the compose file by the
// stop and the start on either side of the gate, the wrapper by the next shell
// an operator types it into — so both are parsed while the stack is still up
// and abandoning is free.
describe("remit update — a release whose compose file will not resolve", () => {
	const box = sandbox({
		scenario: { probe: "ok", migrate_exit: 0 },
		releaseCompose: readFileSync(COMPOSE, "utf8").replace(
			/^services:$/m,
			[
				"services:",
				"  search-preview:",
				"    image: ghcr.io/remit-mail/reader/web:${UNSET_VAR:?the release needs it}",
			].join("\n"),
		),
	});
	const result = box.run(["update"]);

	it("abandons the run", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
	});

	it("abandons it before anything is stopped", () => {
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose stop"));
		assert.equal(box.installedCompose(), readFileSync(COMPOSE, "utf8"));
	});
});

describe("remit update — a release whose wrapper will not parse", () => {
	const box = sandbox({
		scenario: { probe: "ok", migrate_exit: 0 },
		releaseWrapper: [
			"#!/bin/sh",
			"DEFAULT_DIR=/opt/remit",
			"COMPOSE_FILE=docker-compose.sqlite.yml",
			"PROG=remit",
			'case "${1:-}" in',
			"",
		].join("\n"),
	});
	const result = box.run(["update"]);

	it("abandons the run before anything is stopped", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose stop"));
	});
});

// What the asset base names is a shell script this box then runs as root, so
// it is not read on the same terms as any other setting: https, and the origin
// the manifest is already trusted from unless the deployment says otherwise.
describe("remit update — where the release's host files may be read from", () => {
	const attempt = (env) => {
		const box = sandbox({ scenario: { probe: "ok", migrate_exit: 0 }, env });
		return { box, result: box.run(["update"]) };
	};

	it("refuses a base that is not https", () => {
		const { box, result } = attempt({
			REMIT_UPDATE_ASSET_BASE:
				"http://updates.example.test/remit-mail/reader/@TAG@/deploy/vps",
		});
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.equal(box.assetLog(), "");
	});

	it("refuses an origin the manifest is not served from", () => {
		const { box, result } = attempt({
			REMIT_UPDATE_ASSET_BASE:
				"https://elsewhere.example.test/remit-mail/reader/@TAG@/deploy/vps",
		});
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.equal(box.assetLog(), "");
	});

	it("reads from a second origin the deployment named", () => {
		const { box, result } = attempt({
			REMIT_UPDATE_ASSET_BASE:
				"https://elsewhere.example.test/remit-mail/reader/@TAG@/deploy/vps",
			REMIT_UPDATE_ASSET_ORIGIN: "https://elsewhere.example.test",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.match(box.assetLog(), /^https:\/\/elsewhere\.example\.test\//m);
	});
});

// reader#1082. The entry on PATH used to be a copy of the wrapper, and an
// update installs the release's wrapper into the deployment directory: the copy
// kept answering with the release it was taken from. install.sh places an exec
// shim now, and a copy left by an older install says so rather than silently
// refusing a verb the release added.
describe("an entry on PATH that is a copy of an older release", () => {
	const entryBox = (body) => {
		const dir = mkdtempSync(join(TMP_ROOT, "remit-path-entry-"));
		sandboxes.push(dir);
		const deployment = join(dir, "deployment");
		mkdirSync(deployment, { recursive: true });
		writeExecutable(
			join(deployment, "remit"),
			stampWrapper(WRAPPER_SOURCE, {
				dir: deployment,
				composeFile: "docker-compose.sqlite.yml",
				prog: "remit",
			}),
		);
		const entry = join(dir, "entry");
		writeExecutable(entry, body(deployment));
		return spawnSync(
			"sh",
			["-c", '. "$0"\npath_entry_stale "$1" && printf stale', REMIT, entry],
			{
				env: {
					...process.env,
					REMIT_LIB_ONLY: "1",
					REMIT_DIR: deployment,
				},
				encoding: "utf8",
			},
		);
	};

	it("is what a copy of another release is read as", () => {
		const run = entryBox(() => `${wrapperWith(["doctor"])}\n`);
		assert.equal(run.stdout, "stale");
	});

	it("is not what the shim install.sh places is read as", () => {
		const run = entryBox((dir) => `#!/bin/sh\nexec "${dir}/remit" "$@"\n`);
		assert.equal(run.stdout, "");
	});

	// The three lines install.sh stamps belong to the deployment, not to the
	// release, so a wrapper differing only there is the release that is running.
	it("is not what the same release under another stamp is read as", () => {
		const run = entryBox(() =>
			stampWrapper(WRAPPER_SOURCE, {
				dir: "/opt/other",
				composeFile: "docker-compose.sqlite.yml",
				prog: "remit-other",
			}),
		);
		assert.equal(run.stdout, "");
	});

	it("says so on stderr, and never tells the operator to sudo", () => {
		const box = sandbox({
			scenario: { probe: "ok" },
			installedWrapper: installedFor,
		});
		const result = box.run(["status"]);
		assert.match(result.stderr, /is a copy of an older release/);
		assert.ok(!result.stderr.includes("sudo"), result.stderr);
	});
});

// reader#1071. The snapshots directory is made by a root helper container, so a
// prune that runs on the host as the operator cannot unlink anything from it. A
// release that pruned there failed with EACCES on every old run and told the
// operator to sudo rm -rf inside their own deployment.
describe("remit update — the snapshots left by earlier runs", () => {
	const box = sandbox({ scenario: { probe: "ok", migrate_exit: 0 } });
	const stale = ["20260101T000000Z-aaaaaaaa", "20260102T000000Z-bbbbbbbb"];
	box.seedSnapshots(stale, 0o555);
	const result = box.run(["update"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("removes them where they were made, in the helper", () => {
		assert.ok(box.log().includes("run prune-snapshots"));
		for (const dir of stale) {
			assert.ok(
				!box.snapshotDirs().includes(dir),
				`${dir} survived the update`,
			);
		}
	});

	// The sweep keeps exactly one: a rollback after the commit has nothing to
	// restore from if this run's own snapshot goes with the rest.
	it("keeps this run's own snapshot", () => {
		assert.deepEqual(box.snapshotDirs(), [box.stateJson().run.runId]);
	});

	it("never tells the operator to sudo anything", () => {
		const output = `${result.stdout}${result.stderr}`;
		assert.ok(!output.includes("sudo"), output);
		assert.ok(!output.includes("rm:"), output);
	});
});

describe("the volume the databases live on", () => {
	// Compose names every volume after the project, and the snapshot and restore
	// helpers are plain `docker run` containers that name it themselves. Reading
	// the project from anywhere but the .env Compose reads is how an update
	// snapshots an empty volume it just created and reports success.
	const snapshotMount = (box) =>
		box
			.log()
			.split("\n")
			.find((line) => line.startsWith("run snapshot"))
			?.replace("run snapshot sqlite=", "");

	it("is the default project's when the deployment names no project", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		box.run(["update"]);
		assert.equal(snapshotMount(box), "remit_sqlite_data");
	});

	it("follows the project a second deployment installed itself under", () => {
		const box = sandbox({
			scenario: { probe: "ok" },
			dotenv: ["REMIT_PROJECT=beta"],
		});
		box.run(["update"]);
		assert.equal(snapshotMount(box), "beta_sqlite_data");
	});
});

describe("the queue database", () => {
	const box = sandbox({ scenario: { probe: "fail", probe2: "ok" } });
	box.run(["update"]);

	it("is never snapshotted and never restored", () => {
		// Restoring a work queue resurrects already-delivered outbound mail, so
		// the volume it lives on is not even mounted by the helper containers.
		const scripts = box.volumeScripts();
		assert.ok(scripts.length > 0);
		assert.ok(!scripts.includes("queue.db"));
		assert.ok(!scripts.includes("queue_data"));
		assert.ok(!box.log().includes("queue_data"));
	});
});

describe("the restore", () => {
	const box = sandbox({ scenario: { probe: "fail", probe2: "ok" } });
	box.run(["update"]);
	const restore = box
		.volumeScripts()
		.split("--- volume script ---")
		.find((s) => s.includes("cp "));

	it("unlinks the WAL and shared-memory sidecars before copying", () => {
		assert.ok(
			restore.includes(
				"rm -f /data/sqlite/remit.db /data/sqlite/remit.db-wal /data/sqlite/remit.db-shm",
			),
		);
		assert.ok(
			restore.indexOf("rm -f /data/sqlite/remit.db") < restore.indexOf("cp "),
		);
	});

	it("leaves every restored file owned by 1000:1000", () => {
		assert.ok(restore.includes("chown -R 1000:1000 /data/sqlite"));
	});

	it("installs nothing, so it does not need the network it may be recovering from", () => {
		assert.ok(!restore.includes("apk add"));
	});

	it("tolerates an instance with no vector store", () => {
		assert.ok(restore.includes('if [ -f "$snap/vec.db" ]'));
	});
});

describe("the snapshot", () => {
	const box = sandbox({ scenario: { probe: "ok" } });
	box.run(["update"]);
	const snap = box
		.volumeScripts()
		.split("--- volume script ---")
		.find((s) => s.includes("snapshot_db"));

	it("runs as uid 1000, so no root-owned sidecar lands on the volume", () => {
		assert.ok(snap.includes("su-exec 1000:1000"));
	});

	it("goes through the shared VACUUM INTO primitive", () => {
		assert.ok(snap.includes(". /snapshot-db.sh"));
		assert.ok(snap.includes("snapshot_db /data/sqlite/remit.db"));
		assert.ok(snap.includes("snapshot_db /data/sqlite/vec.db"));
	});
});

describe("gate condition 1 — this run's migrate", () => {
	const box = sandbox({
		scenario: {
			migrate_recreate: "no",
			migrate_recreate2: "yes",
			migrate_exit: 0,
			probe: "ok",
			probe2: "ok",
		},
	});
	box.run(["update"]);

	it("fails when the recreate silently no-ops, rather than reading the previous run's success", () => {
		const run = box.stateJson().run;
		assert.equal(run.outcome, "rolledBack");
		assert.match(run.message, /never replaced/);
	});
});

describe("gate condition 2 — a crash loop", () => {
	const box = sandbox({
		scenario: { restarts: 3, restarts2: 0, probe: "ok", probe2: "ok" },
	});
	box.run(["update"]);

	it("rolls back on a restart count that moved", () => {
		const run = box.stateJson().run;
		assert.equal(run.outcome, "rolledBack");
		assert.match(run.message, /keeps restarting/);
	});
});

describe("gate condition 3 — health", () => {
	const box = sandbox({
		scenario: {
			health: "unhealthy",
			health2: "healthy",
			probe: "ok",
			probe2: "ok",
		},
	});
	box.run(["update"]);

	it("rolls back on a service that never reports healthy", () => {
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.match(box.stateJson().run.message, /not healthy/);
	});
});

describe("the pull", () => {
	const box = sandbox({ scenario: { pull: "fail" } });
	const result = box.run(["update"]);

	it("aborts having touched nothing", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose stop"));
		assert.ok(!box.log().includes("run snapshot"));
	});

	it("leaves no run claiming success", () => {
		assert.equal(box.stateJson().run.outcome, "abandoned");
	});
});

describe("discovery is the manifest and only the manifest", () => {
	it("reports a failed check and offers nothing when the manifest is unreachable", () => {
		// A newer tag being present and pullable in the registry is exactly the
		// case this refuses: pushes are not atomic across the roster, so a tag
		// can exist for a version that was never fully published.
		const box = sandbox({ manifest: null, scenario: { probe: "ok" } });
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().check.status, "failed");
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("refuses a version at or below the running one", () => {
		const box = sandbox({ manifest: { ...MANIFEST, version: "v1.0.0" } });
		box.run(["update"]);
		assert.equal(box.stateJson().check.updateAvailable, false);
		assert.equal(box.stateJson().run, null);
	});

	it("refuses images outside the manifest's registry, before any pull", () => {
		const box = sandbox({
			manifest: { ...MANIFEST, registry: "ghcr.io/someone-else" },
		});
		box.run(["update"]);
		assert.equal(box.stateJson().check.status, "failed");
		assert.match(box.stateJson().check.error, /outside ghcr.io\/someone-else/);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("does not fetch at all when no manifest URL is configured", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const result = box.run(["update", "--check"], {
			...box.env,
			REMIT_UPDATE_MANIFEST_URL: "",
		});
		// The .env still carries a URL, so this only proves the check honours an
		// explicit empty override the way a cleared .env would.
		assert.equal(result.status, 0, result.stderr);
	});

	it("never consults the registry for a version", () => {
		const wrapper = readFileSync(REMIT, "utf8");
		for (const probe of [
			/docker\s+manifest/,
			/docker\s+image\s+ls/,
			/docker\s+images/,
			/--filter\s+reference/,
			/\/v2\/[^\s"']*\/tags/,
		]) {
			assert.ok(!probe.test(wrapper), `${probe} appears in the wrapper`);
		}
	});
});

describe("the control seam", () => {
	it("rejects a targetVersion carrying a shell expansion", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				targetVersion: "v1.0.0; touch /pwned",
				requestedAt: justNow(),
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
	});

	it("takes a request carrying only the four fields the backend writes", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-1",
				targetVersion: "v1.5.0",
				requestedAt: justNow(),
				requestedBy: "owner@example.test",
			}),
		);
		box.run(["update"]);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("runs a backend-initiated update under the id the request named", () => {
		// The id the API handed the browser is the one it polls on, so a run that
		// mints its own is unmatchable from the first real poll onward (#583).
		const requested = "9f3c1e2a-4b5d-4c6e-8f70-112233445566";
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: requested,
				targetVersion: "v1.5.0",
				requestedAt: justNow(),
				requestedBy: "owner@example.test",
			}),
		);
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.runId, requested);
		const run = JSON.parse(readFileSync(join(box.state, "run.json"), "utf8"));
		assert.equal(run.runId, requested);
		assert.equal(run.outcome, "succeeded");
	});

	it("mints an id for an operator's own update, which no request named", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(box.stateJson().run.runId, /^\d{8}T\d{6}Z-[0-9a-f]+$/);
	});

	it("rejects a runId that would reach outside the snapshot directory", () => {
		// Adopting the id means it names a directory the run creates and prunes,
		// so an unusable one refuses the whole request rather than being replaced.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				targetVersion: "v1.5.0",
				runId: "../../../etc",
				requestedAt: justNow(),
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("rejects a file naming a registry, an image or a digest, and does nothing", () => {
		// The acceptance criterion: a registry/image/digest never crosses the
		// seam because the whole file is refused, not because the extra field is
		// ignored. No partial action — no pull, no stop.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				targetVersion: "v1.5.0",
				requestedAt: justNow(),
				registry: "ghcr.io/attacker",
				image: "evil:latest",
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
		assert.ok(!box.log().includes("attacker"));
		assert.ok(!box.volumeScripts().includes("attacker"));
	});

	it("rejects an over-sized file whole, taking no partial action", () => {
		// Oversized is refused on read rather than truncated to a parseable head:
		// a truncated parse of an attacker-controlled file is a partial honouring.
		const box = sandbox({ scenario: { probe: "ok" } });
		const padding = "x".repeat(8192);
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ targetVersion: "v1.5.0", pad: padding }),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
		assert.ok(!box.log().includes("run snapshot"));
	});

	it("rejects a nested or non-flat object", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				targetVersion: "v1.5.0",
				requestedAt: justNow(),
				meta: { via: "api" },
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("rejects trailing tokens after the object the request ends with", () => {
		// A file whose first object is well-formed is still a file the backend did
		// not write. Reading only up to the balanced brace honours the half an
		// attacker wants honoured, so the whole file is refused (#241).
		const box = sandbox({ scenario: { probe: "ok" } });
		const request = JSON.stringify({
			targetVersion: "v1.5.0",
			requestedAt: justNow(),
		});
		writeFileSync(
			join(box.state, "request.json"),
			`${request} ghcr.io/attacker`,
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
	});

	it("rejects tokens standing before the object the request opens with", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const request = JSON.stringify({
			targetVersion: "v1.5.0",
			requestedAt: justNow(),
		});
		writeFileSync(
			join(box.state, "request.json"),
			`"registry":"ghcr.io/attacker" ${request}`,
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
	});

	it("rejects a key the file ran together with the one before it", () => {
		// A member carrying no comma between it and its predecessor is invisible
		// to a parser that only counts braces: the key is never read, so the
		// whitelist never sees it and the field it names crosses the seam
		// unexamined. The gap itself is the refusal (#241).
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			`{"targetVersion":"v1.5.0","requestedAt":"${justNow()}" "registry":"ghcr.io/attacker"}`,
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run, null);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
		assert.ok(!box.log().includes("attacker"));
		assert.ok(!box.volumeScripts().includes("attacker"));
	});

	it("takes a request padded with whitespace around the object", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			`\n  ${JSON.stringify({
				targetVersion: "v1.5.0",
				requestedAt: justNow(),
			})}\n\n`,
		);
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("reads the request off the control volume, separate from the state volume", () => {
		// The updater mounts request.json/state.json on a volume shared with the
		// backend, while the run's lock, breadcrumb and snapshots stay on its own
		// volume out of the backend's reach.
		const box = sandbox({ scenario: { probe: "ok" } });
		const control = join(box.dir, "control");
		mkdirSync(control, { recursive: true });
		writeFileSync(
			join(control, "request.json"),
			JSON.stringify({ targetVersion: "v1.5.0", requestedAt: justNow() }),
		);
		const result = box.run(["update"], {
			...box.env,
			REMIT_UPDATE_CONTROL_DIR: control,
		});
		assert.equal(result.status, 0, result.stderr);
		const state = JSON.parse(readFileSync(join(control, "state.json"), "utf8"));
		assert.equal(state.run.outcome, "succeeded");
		// The request is consumed on the control volume; the breadcrumb and its
		// snapshots never land there.
		assert.throws(() => readFileSync(join(control, "request.json")));
		assert.throws(() => readFileSync(join(control, "breadcrumb")));
	});

	it("writes state.json to the control volume on a check, not the private state volume", () => {
		// This is the path the updater container runs on its cadence: a check must
		// land the composed document on the seam the backend reads, carrying the
		// running tag as currentVersion, while the raw check block stays on the
		// updater's own volume.
		const box = sandbox({ scenario: { probe: "ok" } });
		const control = join(box.dir, "control");
		mkdirSync(control, { recursive: true });
		const result = box.run(["update", "--check"], {
			...box.env,
			REMIT_UPDATE_CONTROL_DIR: control,
		});
		assert.equal(result.status, 0, result.stderr);
		const state = JSON.parse(readFileSync(join(control, "state.json"), "utf8"));
		assert.equal(state.check.status, "ok");
		assert.equal(state.currentVersion, "v1.0.0");
		assert.throws(() => readFileSync(join(box.state, "state.json")));
	});

	it("refuses a version the manifest does not name", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ targetVersion: "v9.9.9", requestedAt: justNow() }),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("discards a request older than the window instead of installing it", () => {
		// The #587 scenario: the updater was absent — a failed preflight, a stopped
		// box — while the request sat on the seam. The container that finally finds
		// it must not stop the stack for an install nobody is waiting on any more.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-stale",
				targetVersion: "v1.5.0",
				requestedAt: agedBy(3 * 24 * 60 * 60),
				requestedBy: "owner@example.test",
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.throws(() => readFileSync(join(box.state, "request.json")));
	});

	it("says the request was discarded, in the log and on the seam", () => {
		// Silence would trade a surprise install for a surprise no-op. run.json is
		// what `remit status` prints and what the app renders, so the operator can
		// tell an install was asked for and deliberately not performed.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-stale",
				targetVersion: "v1.5.0",
				requestedAt: agedBy(3 * 24 * 60 * 60),
				requestedBy: "owner@example.test",
			}),
		);
		const result = box.run(["update"]);
		const run = box.stateJson().run;
		assert.equal(run.outcome, "abandoned");
		// The id the request named, so a page still polling gets a verdict on its
		// own run rather than never hearing back.
		assert.equal(run.runId, "r-stale");
		// The same sentence report_last_run prints under `remit status` and the app
		// renders, and the line the updater's own log carries.
		assert.match(run.message, /discarded rather than installed/);
		assert.match(result.stdout, /discarded rather than installed/);
	});

	it("discards a request carrying no time it was made", () => {
		// The pre-#587 shape. An absent timestamp cannot show the request is
		// current, so it is expired rather than assumed fresh.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ runId: "r-old", targetVersion: "v1.5.0" }),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.match(box.stateJson().run.message, /carried no time it was made/);
	});

	it("discards a request stamped ahead of the instance's own clock", () => {
		// The window needs a floor as well as a ceiling. A box with no RTC comes up
		// reading roughly its own shutdown time, so a request written just before a
		// `remit stop` reads as minutes old days later — the surviving-a-stop case
		// #587 names, and the one an age bounded only from above lets through.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-ahead",
				targetVersion: "v1.5.0",
				requestedAt: agedBy(-10 * 24 * 60 * 60),
				requestedBy: "owner@example.test",
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.match(box.stateJson().run.message, /ahead of this instance's own/);
	});

	it("discards a request whose time is not a time", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-junk",
				targetVersion: "v1.5.0",
				requestedAt: "yesterday",
			}),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.ok(!box.stateJson().run.message.includes("yesterday"));
	});

	it("installs a request still inside the window", () => {
		// The window is bounded from below as well: an update the owner asked for
		// minutes ago is theirs, and a run that has been waiting on a slow pull or
		// a restarted updater still installs.
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				runId: "r-fresh",
				targetVersion: "v1.5.0",
				requestedAt: agedBy(25 * 60),
				requestedBy: "owner@example.test",
			}),
		);
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.equal(box.stateJson().run.runId, "r-fresh");
	});

	it("reads back every timestamp shape the backend writes, to the second", () => {
		// The conversion is hand-rolled arithmetic, because neither GNU nor busybox
		// date parses a timestamp portably. A month, leap-day or century error here
		// expires a live request or keeps a dead one. The claim is bounded to what
		// the backend emits — `new Date().toISOString()`, always UTC, sometimes
		// with milliseconds; the two places this parser and Date.parse disagree are
		// pinned in the test below.
		const stamps = [
			"1970-01-01T00:00:00Z",
			"2000-02-29T12:34:56Z",
			"2024-12-31T23:59:59Z",
			"2026-03-01T00:00:00Z",
			"2026-08-17T23:00:02.123Z",
			"2100-03-01T00:00:00Z",
		];
		for (const stamp of stamps) {
			const result = spawnSync(
				"sh",
				["-c", '. "$0"\niso_epoch "$1"', REMIT, stamp],
				{ env: { ...process.env, REMIT_LIB_ONLY: "1" }, encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(
				result.stdout.trim(),
				String(Math.floor(Date.parse(stamp) / 1000)),
				stamp,
			);
		}
		for (const junk of ["", "yesterday", "2026-08-17", "2026-08-17T10:00:00"]) {
			const result = spawnSync(
				"sh",
				["-c", '. "$0"\niso_epoch "$1"', REMIT, junk],
				{ env: { ...process.env, REMIT_LIB_ONLY: "1" }, encoding: "utf8" },
			);
			assert.equal(result.stdout.trim(), "", junk);
		}
	});

	it("diverges from Date.parse only where the divergence is safe", () => {
		// Two shapes the backend cannot produce, pinned so a later widening of the
		// parser is a deliberate act rather than a side effect.
		const readsAs = (stamp) =>
			spawnSync("sh", ["-c", '. "$0"\niso_epoch "$1"', REMIT, stamp], {
				env: { ...process.env, REMIT_LIB_ONLY: "1" },
				encoding: "utf8",
			}).stdout.trim();

		// An explicit offset is a time Date.parse reads and this parser refuses.
		// Refusing expires the request, which is the safe direction: the seam's
		// contract is UTC, and an offset silently read as UTC would be wrong by
		// hours in whichever direction the window does not forgive.
		assert.ok(!Number.isNaN(Date.parse("2026-08-17T10:00:00+02:00")));
		assert.equal(readsAs("2026-08-17T10:00:00+02:00"), "");

		// A leap second is a time this parser reads and Date.parse refuses. It
		// rolls into the following minute — one second wrong against a window
		// measured in minutes, and no request the backend writes carries one.
		assert.ok(Number.isNaN(Date.parse("2026-08-17T23:59:60Z")));
		assert.equal(
			readsAs("2026-08-17T23:59:60Z"),
			String(Date.parse("2026-08-18T00:00:00Z") / 1000),
		);
	});

	it("consumes the request so a refusal is not retried forever", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ targetVersion: "v9.9.9", requestedAt: justNow() }),
		);
		box.run(["update"]);
		assert.throws(() => readFileSync(join(box.state, "request.json")));
	});
});

describe("recovery branches on the recorded phase", () => {
	const interrupted = (phase, scenario) => {
		const box = sandbox({ scenario });
		box.writeBreadcrumb({
			runId: "run-1",
			fromVersion: "v1.0.0",
			targetVersion: "v1.5.0",
			startedAt: "2026-07-20T08:00:00Z",
			snapshot: join(box.state, "snapshots", "run-1"),
			services: ALL_SERVICES,
			migrateBefore: "cmigrate-old",
			phase,
		});
		mkdirSync(join(box.state, "snapshots", "run-1"), { recursive: true });
		return box;
	};

	it("abandons a run killed while snapshotting, changing nothing", () => {
		const box = interrupted("snapshotting", { probe: "ok" });
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "abandoned");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose stop"));
	});

	it("commits a run killed after a good upgrade", () => {
		const box = interrupted("verifying", { probe: "ok" });
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("rolls back a run killed mid-migration", () => {
		const box = interrupted("starting", {
			migrate_exit: 1,
			migrate_exit2: 0,
			probe: "ok",
		});
		box.run(["update", "--recover"]);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
	});

	it("never reports success for a run killed while rolling back, however healthy the stack is", () => {
		const box = interrupted("rollingBack", {
			probe: "ok",
			probe2: "ok",
			migrate_exit: 0,
		});
		box.run(["update", "--recover"]);
		const outcome = box.stateJson().run.outcome;
		assert.ok(["rolledBack", "rollbackFailed"].includes(outcome), outcome);
	});

	it("reports a rollback that finished, even where compose reuses the migrate container", () => {
		const box = interrupted("rollingBack", { probe: "ok", migrate_exit: 0 });
		box.run(["update", "--recover"]);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
	});

	it("reads .env fresh, so a host reboot mid-run still brings the stack up", () => {
		const box = interrupted("stopping", { probe: "ok" });
		box.run(["update", "--recover"]);
		assert.ok(box.log().includes("compose up -d queue migrate backend"));
	});

	it("does nothing when there is no breadcrumb", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0);
		assert.match(result.stdout, /No interrupted update/);
		assert.equal(box.log(), "");
	});
});

// reader#494. The state a host reboot leaves behind once the migration has run:
// .env on the new tag, the schema lifted, writes on top of it, and the
// pre-update snapshot still on the state volume.
function interruptedAfterTheMigration(phase, scenario = {}) {
	const box = sandbox({
		realDb: true,
		tag: "v1.5.0",
		scenario: { probe: "ok", migrate_exit: 0, target_schema: 9, ...scenario },
		manifest: { ...MANIFEST, schemaVersion: 9 },
	});
	const snapshot = join(box.state, "snapshots", "run-1", "remit.db");
	mkdirSync(dirname(snapshot), { recursive: true });
	copyFileSync(box.liveDb, snapshot);
	applyMigrationAndWrite(box.liveDb, "written after the migration");
	box.writeBreadcrumb({
		runId: "run-1",
		fromVersion: "v1.0.0",
		targetVersion: "v1.5.0",
		startedAt: "2026-07-20T08:00:00Z",
		snapshot: dirname(snapshot),
		services: ALL_SERVICES,
		migrateBefore: "cmigrate-old",
		phase,
	});
	return box;
}

const migrateCid = (box) => readFileSync(join(box.fake, "cid-migrate"), "utf8");

// The gate reads the migrate container id from before the update, and after an
// interruption the breadcrumb is the only place that survives. Nothing in the
// deployment has moved since, so compose reuses the exited one-shot.
describe("the gate honours the recorded migrate container (reader#494)", () => {
	const box = interruptedAfterTheMigration("verifying");
	const before = migrateCid(box);
	const result = box.run(["update", "--recover"]);

	it("reuses the migrate container, the way compose does", () => {
		assert.equal(migrateCid(box), before);
	});

	it("commits the update", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.5.0");
	});

	it("keeps the migrated database and the writes that followed it", () => {
		assert.ok(!box.log().includes("run restore"));
		assert.equal(box.liveSchema(), 9);
		assert.equal(box.liveHasFilterMove(), true);
		assert.deepEqual(messageSubjects(box.liveDb), [
			"hello",
			"written after the migration",
		]);
	});
});

// By `committing` the gate has already returned; the snapshot beside the
// migrated database is older than everything served since.
describe("a run interrupted after its verdict is never rolled back (reader#494)", () => {
	const box = interruptedAfterTheMigration("committing", {
		probe: "fail",
		restarts: 3,
	});
	const result = box.run(["update", "--recover"]);

	it("finishes the update", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.5.0");
	});

	it("keeps the migrated database and the writes that followed it", () => {
		assert.ok(!box.log().includes("run restore"));
		assert.equal(box.liveSchema(), 9);
		assert.equal(box.liveHasFilterMove(), true);
		assert.deepEqual(messageSubjects(box.liveDb), [
			"hello",
			"written after the migration",
		]);
	});

	it("brings the app plane back up", () => {
		assert.ok(box.log().includes("compose up -d queue migrate backend"));
	});
});

describe("the lock", () => {
	it("refuses a second run while one is in flight", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		mkdirSync(box.state, { recursive: true });
		const holder = spawn(
			"sh",
			["-c", `exec 9>"${join(box.state, "update.lock")}"; flock 9; sleep 20`],
			{ detached: true, stdio: "ignore" },
		);
		try {
			// Give the holder time to take it before racing it.
			spawnSync("sh", ["-c", "sleep 1"]);
			const result = box.run(["update"]);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /already running/);
		} finally {
			process.kill(-holder.pid, "SIGKILL");
		}
	});

	it("is released by the kernel when its holder dies, so boot recovery is never locked out", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		mkdirSync(box.state, { recursive: true });
		const holder = spawn(
			"sh",
			["-c", `exec 9>"${join(box.state, "update.lock")}"; flock 9; sleep 20`],
			{ detached: true, stdio: "ignore" },
		);
		spawnSync("sh", ["-c", "sleep 1"]);
		process.kill(-holder.pid, "SIGKILL");
		spawnSync("sh", ["-c", "sleep 1"]);
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
	});

	it("survives its own holder being killed mid-run, and recovery finishes without an operator", async () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(join(box.fake, "hang-stop"), "");
		const child = spawn("sh", [REMIT, "update"], {
			env: box.env,
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() => {
				try {
					return box.breadcrumb().includes("phase=stopping");
				} catch {
					return false;
				}
			});
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		rmSync(join(box.fake, "hang-stop"));

		// The wrapper's lock fd is inherited by the hung `docker stop` and its
		// `sleep`, so the kernel releases the flock only once all three are
		// reaped — which SIGKILL schedules but does not await. Recover's own
		// `flock -n` would race that and spuriously report "already running",
		// so wait until the lock is observably free before recovering.
		await waitForLockFree(join(box.state, "update.lock"));

		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(box.stateJson().run.outcome !== null);
	});
});

describe("the updater self-replace survives the wrapper (reader#291)", () => {
	// The recreate cannot be issued from the updater's own process: compose kills
	// that container mid-recreate and leaves the replacement `Created` under a temp
	// name. It is handed to a detached one-shot container instead, launched only
	// after the verdict is durable, and the handoff is recorded for a boot recover.
	const box = sandbox({
		scenario: {
			probe: "ok",
			all_services: `${ALL_SERVICES} migrate volume-init updater`,
		},
	});
	box.run(["update"]);
	const lines = box.log().split("\n");

	it("never recreates the updater from this process", () => {
		// The old bug: `compose up -d updater` run in-process. It must not appear —
		// the wrapper is the container that call would kill.
		assert.ok(!lines.includes("compose up -d updater"));
	});

	it("hands the recreate to a detached container, after the gate", () => {
		const recreate = lines.findIndex((l) =>
			l.startsWith("run updater-recreate"),
		);
		assert.ok(
			recreate >= 0,
			"the updater was never handed off for replacement",
		);
		assert.match(lines[recreate], /detached=1/);
		assert.match(lines[recreate], /entrypoint=sh/);
		const gateUp = lines.findIndex((l) =>
			l.includes("up -d queue migrate backend"),
		);
		assert.ok(gateUp >= 0 && gateUp < recreate);
	});

	it("records the handoff on the state volume for a boot recover to read", () => {
		const handoff = readFileSync(join(box.state, "updater-handoff"), "utf8");
		assert.match(handoff, /tag=v1\.5\.0/);
	});

	it("keeps the updater out of the services it brings back", () => {
		const box = sandbox({
			scenario: {
				probe: "ok",
				services: `${ALL_SERVICES} updater`,
				all_services: `${ALL_SERVICES} migrate volume-init updater`,
			},
		});
		box.run(["update"]);
		const held = box
			.log()
			.split("\n")
			.filter((l) => l.startsWith("compose up -d ") && l.includes("apisix"));
		assert.equal(held.length, 1);
		assert.ok(!held[0].includes("updater"));
	});
});

// reader#1048: the pruner ran inside commit_run under `set -eu`, ahead of both
// the verdict and the self-replace, and never read what `rm -rf` returned. One
// snapshot left root-owned by an older release aborted the commit — the run
// record stopped at `committing`, `remit status` read an update still in
// progress, and the updater stayed on the old image while the rest of the stack
// moved to the new one.
describe("a snapshot that cannot be pruned does not hold back the commit (reader#1048)", () => {
	// The suite runs as one uid, and as root nothing on a volume is unremovable
	// at all, so the refusal is injected where the wrapper meets it: an `rm` on
	// PATH that fails for that one path and execs the real one for everything
	// else.
	function stuckSnapshotBox() {
		const box = sandbox({
			scenario: {
				probe: "ok",
				migrate_exit: 0,
				all_services: `${ALL_SERVICES} migrate volume-init updater`,
			},
		});
		// Named so it is pruned before the removable one: what follows it in the
		// loop is what proves the failure did not end the sweep.
		const stuck = join(box.state, "snapshots", "run-2026-07");
		const removable = join(box.state, "snapshots", "run-2026-08");
		for (const dir of [stuck, removable]) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "remit.db"), "an older release's snapshot");
		}
		const realRm = spawnSync("sh", ["-c", "command -v rm"], {
			encoding: "utf8",
		}).stdout.trim();
		writeExecutable(
			join(box.dir, "bin", "rm"),
			[
				"#!/bin/sh",
				'for a in "$@"; do',
				`  if [ "$a" = "${stuck}" ]; then`,
				`    printf "rm: cannot remove '%s': Permission denied\\n" "$a" >&2`,
				"    exit 1",
				"  fi",
				"done",
				`exec ${realRm} "$@"`,
				"",
			].join("\n"),
		);
		return { box, result: box.run(["update"]), stuck, removable };
	}

	const { box, result, stuck, removable } = stuckSnapshotBox();

	it("terminates the run as succeeded", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
	});

	it("still hands the updater off for replacement", () => {
		assert.ok(
			box
				.log()
				.split("\n")
				.some((l) => l.startsWith("run updater-recreate")),
			"the updater was never handed off for replacement",
		);
		assert.match(
			readFileSync(join(box.state, "updater-handoff"), "utf8"),
			/tag=v1\.5\.0/,
		);
	});

	it("names the snapshot it could not remove", () => {
		assert.match(
			result.stderr,
			new RegExp(`could not remove the snapshot at ${stuck}`),
		);
	});

	it("never tells the operator to sudo anything", () => {
		assert.ok(!result.stderr.includes("sudo"), result.stderr);
	});

	it("leaves the snapshot in place and prunes the rest", () => {
		assert.ok(existsSync(stuck), "the unremovable snapshot was reported gone");
		assert.ok(!existsSync(removable), "the sweep stopped at the first failure");
	});
});

describe("a boot recover verifies the updater self-replace (reader#291)", () => {
	const withHandoff = (fields, { done = false, scenario = {} } = {}) => {
		const box = sandbox({ scenario: { probe: "ok", ...scenario } });
		mkdirSync(box.state, { recursive: true });
		writeFileSync(
			join(box.state, "updater-handoff"),
			`${Object.entries(fields)
				.map(([k, v]) => `${k}=${v}`)
				.join("\n")}\n`,
		);
		if (done) writeFileSync(join(box.state, "updater-handoff.done"), "");
		return box;
	};

	it("clears a confirmed handoff and says so", () => {
		const box = withHandoff(
			{ runId: "run-1", tag: "v1.5.0", at: "2026-07-20T08:00:00Z" },
			{ done: true },
		);
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			/self-replace for run-1 \(v1\.5\.0\) completed/,
		);
		assert.throws(() => readFileSync(join(box.state, "updater-handoff")));
		assert.throws(() => readFileSync(join(box.state, "updater-handoff.done")));
	});

	it("re-issues an unconfirmed handoff, then clears it", () => {
		const box = withHandoff(
			{ runId: "run-2", tag: "v1.5.0", at: "2026-07-20T08:00:00Z" },
			{ scenario: { all_services: `${ALL_SERVICES} updater` } },
		);
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			/finishing an unconfirmed updater self-replace/,
		);
		assert.ok(
			box
				.log()
				.split("\n")
				.some((l) => l.startsWith("run updater-recreate")),
		);
		assert.throws(() => readFileSync(join(box.state, "updater-handoff")));
	});

	it("does nothing when there is no handoff", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(!box.log().includes("run updater-recreate"));
	});
});

describe("the health probe cannot ghost (reader#284)", () => {
	it("runs the probe with an explicit wget entrypoint, never the image default", () => {
		// Without --entrypoint the updater image runs its own ENTRYPOINT and the wget
		// arguments become ignored daemon arguments; the probe container never exits
		// and the verify hangs. The entrypoint the fake records must be wget.
		const box = sandbox({ scenario: { probe: "ok" } });
		box.run(["update"]);
		const probes = box
			.log()
			.split("\n")
			.filter((l) => l.startsWith("run probe"));
		assert.ok(probes.length > 0, "the backend was never probed");
		for (const line of probes) {
			assert.match(line, /entrypoint=wget/);
		}
	});

	it("caps every helper docker run with a timeout in the wrapper", () => {
		// The cap is a parent process around `docker run`, so it leaves no trace the
		// fake docker can see — the source is where it is asserted. Every helper run
		// goes through capped_run; a bare `docker run` that skips it is the defect.
		const wrapper = readFileSync(REMIT, "utf8");
		assert.ok(
			/capped_run\(\)\s*\{[^}]*timeout\b/.test(wrapper),
			"capped_run does not wrap the command in timeout",
		);
		const bareRuns = wrapper
			.split("\n")
			.filter((l) => !l.trimStart().startsWith("#"))
			.filter((l) => /\bdocker run\b/.test(l) && !/capped_run/.test(l));
		assert.deepEqual(
			bareRuns,
			[],
			`a helper docker run is not capped: ${bareRuns.join(" | ")}`,
		);
	});

	it("caps the lock holder's docker inspect while the guard is held", () => {
		// lock_holder_dead runs under the blocking guard flock: an uncapped
		// docker inspect there hangs every future `remit update` on a wedged
		// daemon — the #284 hang class in the lock path.
		const wrapper = readFileSync(REMIT, "utf8");
		const fn = wrapper.match(/lock_holder_dead\(\)\s*\{[\s\S]*?\n\}/)?.[0];
		assert.ok(fn, "lock_holder_dead not found");
		const inspects = fn
			.split("\n")
			.filter((l) => !l.trimStart().startsWith("#"))
			.filter((l) => /\bdocker inspect\b/.test(l) && !/capped_run/.test(l));
		assert.deepEqual(
			inspects,
			[],
			`lock_holder_dead has an uncapped docker inspect: ${inspects.join(" | ")}`,
		);
	});

	it("reaches a terminal outcome even when the probe never answers", () => {
		// probe=hang makes the fake probe block like the ghost did. The wrapper's
		// per-probe timeout has to end each one so the gate's budget deadline is
		// reached and a verdict written, rather than the verify sitting forever.
		const box = sandbox({ scenario: { probe: "hang", probe2: "ok" } });
		const started = Date.now();
		const result = box.run(["update"], {
			...box.env,
			REMIT_UPDATE_PROBE_RUN_TIMEOUT: "1",
			FAKE_PROBE_HANG: "8",
		});
		const elapsedMs = Date.now() - started;
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.ok(elapsedMs < 30_000, `verify took ${elapsedMs}ms`);
	});
});

describe("the update lock reclaims a dead holder (reader#285)", () => {
	it("takes over a lock whose recorded container is gone, and says so", () => {
		// A live fd still holds the flock — a wedged holder that never released it —
		// but the identity names a container the daemon reports gone. That is proof
		// of a dead logical holder, so the lock is reclaimed rather than refused.
		const box = sandbox({ scenario: { probe: "ok" } });
		mkdirSync(box.state, { recursive: true });
		const lockPath = join(box.state, "update.lock");
		const holder = spawn(
			"sh",
			["-c", `exec 9>"${lockPath}"; flock 9; sleep 20`],
			{ detached: true, stdio: "ignore" },
		);
		try {
			spawnSync("sh", ["-c", "sleep 1"]);
			// The wedged holder's own recorded identity: a container the fake reports
			// not-running, so lock_holder_dead resolves it dead.
			writeFileSync(
				lockPath,
				"pid=999999\nkind=container\ncontainer=cdead\nstartedAt=2026-07-20T08:00:00Z\nepoch=1\n",
			);
			const result = box.run(["update", "--recover"]);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /reclaimed a stale update lock left by/);
		} finally {
			process.kill(-holder.pid, "SIGKILL");
		}
	});

	it("still refuses when the holder cannot be placed dead", () => {
		// The identity-less holder of the flock test above: no pid, no container to
		// resolve, age under the ceiling. Conservative — it is refused, not stolen.
		const box = sandbox({ scenario: { probe: "ok" } });
		mkdirSync(box.state, { recursive: true });
		const holder = spawn(
			"sh",
			["-c", `exec 9>"${join(box.state, "update.lock")}"; flock 9; sleep 20`],
			{ detached: true, stdio: "ignore" },
		);
		try {
			spawnSync("sh", ["-c", "sleep 1"]);
			const result = box.run(["update"]);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /already running/);
		} finally {
			process.kill(-holder.pid, "SIGKILL");
		}
	});
});

describe("the updater never stops itself (reader#271)", () => {
	// In-container the wrapper IS the updater, and a bare `compose stop` would
	// stop the container this code runs in — the run dies with the site down and
	// no process left to finish or roll back. The stop set is by-name and excludes
	// the updater, so the old bug is structurally prevented, not recovered from.
	const box = sandbox({
		scenario: {
			probe: "ok",
			services: `${ALL_SERVICES} updater`,
			all_services: `${ALL_SERVICES} updater`,
		},
	});
	box.run(["update"]);
	const stops = box
		.log()
		.split("\n")
		.filter((l) => l.startsWith("compose stop"));

	it("issues at least one stop", () => {
		assert.ok(stops.length > 0, "nothing was stopped");
	});

	it("never names the updater in any stop set", () => {
		for (const line of stops) {
			assert.ok(
				!line.split(/\s+/).includes("updater"),
				`a stop named the updater: ${line}`,
			);
		}
	});

	it("never issues a bare stop that would take the updater down with everything", () => {
		// A bare `compose stop` stops every service, updater included; every stop
		// here is scoped to a named service list instead.
		for (const line of stops) {
			assert.notEqual(line.trim(), "compose stop");
		}
	});
});

describe("caddy stays up across the whole update (front door never goes dark)", () => {
	// caddy is not version-pinned and holds no app volume, so nothing collides by
	// leaving it running; its reverse_proxy re-dials a swapped upstream for
	// lb_try_duration, so a request that lands while the app plane is down is held
	// and served rather than meeting a refused connection. Stopping it was the
	// whole of the user-visible outage, so the stop set must never name it.
	const box = sandbox({ scenario: { probe: "ok" } });
	box.run(["update"]);
	const stops = box
		.log()
		.split("\n")
		.filter((l) => l.startsWith("compose stop"));

	it("never names caddy in any stop set", () => {
		assert.ok(stops.length > 0, "nothing was stopped");
		for (const line of stops) {
			assert.ok(
				!line.split(/\s+/).includes("caddy"),
				`a stop named caddy: ${line}`,
			);
		}
	});

	it("still stops the app plane it must (backend, workers)", () => {
		const stopped = stops.join(" ").split(/\s+/);
		assert.ok(stopped.includes("backend"));
		assert.ok(stopped.includes("imap-worker"));
	});

	it("leaves caddy running after the update commits", () => {
		// The fake tracks a service as up via its up-<svc> marker; a still-serving
		// caddy is the point, so assert it directly against the fake's state.
		assert.ok(
			existsSync(join(box.fake, "up-caddy")),
			"caddy was taken down during the update",
		);
	});
});

describe("tunnel stays up across the whole update under TLS_MODE=tunnel (reader#762)", () => {
	// Under TLS_MODE=tunnel the cloudflared agent is the second edge component,
	// reached by the template's COMPOSE_PROFILES line — so setting the mode is
	// what puts tunnel in an unscoped `config --services`, exactly as on a real
	// deployment. Stopping it for the update window leaves caddy's reverse_proxy
	// with no connection to re-dial: Cloudflare answers the operator's browser
	// with its own 530 instead of a request caddy could hold and retry.
	const box = sandbox({
		tlsMode: "tunnel",
		scenario: { probe: "ok", services: `${ALL_SERVICES} tunnel` },
	});
	box.run(["update"]);
	const stops = box
		.log()
		.split("\n")
		.filter((l) => l.startsWith("compose stop"));

	it("never names tunnel in any stop set", () => {
		assert.ok(stops.length > 0, "nothing was stopped");
		for (const line of stops) {
			assert.ok(
				!line.split(/\s+/).includes("tunnel"),
				`a stop named tunnel: ${line}`,
			);
		}
	});

	it("still stops the app plane it must (backend, workers)", () => {
		const stopped = stops.join(" ").split(/\s+/);
		assert.ok(stopped.includes("backend"));
		assert.ok(stopped.includes("imap-worker"));
	});

	it("leaves tunnel running after the update commits", () => {
		assert.ok(
			existsSync(join(box.fake, "up-tunnel")),
			"tunnel was taken down during the update",
		);
	});
});

describe("the updater proves its mount before serving (reader#272)", () => {
	it("passes when the deployment directory is mounted at its host path", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		const result = box.run(["update", "--preflight"]);
		assert.equal(result.status, 0, result.stderr);
	});

	it("hands the daemon an absolute host path, never a container-local one", () => {
		// The identity probe binds the deployment directory the same way a real
		// helper container does; the source it sends must be an absolute host path,
		// which is the whole point of the identity mount.
		const box = sandbox({ scenario: { probe: "ok" } });
		box.run(["update", "--preflight"]);
		const identity = box
			.log()
			.split("\n")
			.find((l) => l.startsWith("run identity "));
		assert.ok(identity, "the identity probe never ran");
		const src = identity.replace(/^run identity src=/, "");
		assert.ok(src.startsWith("/"), `bind source is not absolute: ${src}`);
		assert.equal(src, box.deployment);
	});

	it("refuses and records a renderable failure when the mount is wrong", () => {
		// A mount that is not the host path: the marker written here never comes
		// back through the daemon, so the wrapper records a failed check on the seam
		// and exits non-zero. The app renders the failure; no update is driven.
		const box = sandbox({
			scenario: { probe: "ok", mount_identity: "broken" },
		});
		const result = box.run(["update", "--preflight"]);
		assert.notEqual(result.status, 0);
		const state = box.stateJson();
		assert.equal(state.check.status, "failed");
		assert.match(state.check.error, /272/);
		// It refused before driving anything: no stop, no pull.
		assert.ok(!box.log().includes("compose stop"));
		assert.ok(!box.log().includes("compose pull"));
	});
});

describe("the backup sidecar", () => {
	// It is a stock image behind a profile under `restart: unless-stopped`, so an
	// unscoped stop leaves it running — and it opens remit.db read-write every
	// interval, which races the restore.
	const box = sandbox({
		scenario: {
			probe: "fail",
			probe2: "ok",
			services: `${ALL_SERVICES} backup`,
		},
	});
	box.run(["update"]);
	const lines = box.log().split("\n");

	it("is stopped by name before the restore", () => {
		const named = lines.findIndex(
			(l) => l.startsWith("compose stop ") && l.includes("backup"),
		);
		const restore = lines.indexOf("run restore");
		assert.ok(named >= 0, "the backup sidecar was never stopped by name");
		assert.ok(restore >= 0 && named < restore);
	});
});

describe("remit status", () => {
	it("reports the running version, the last check and the last run", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		box.run(["update"]);
		const status = box.run(["status"]);
		assert.equal(status.status, 0, status.stderr);
		assert.match(status.stdout, /Tag:\s+v1\.5\.0/);
		assert.match(status.stdout, /Updates:\s+up to date/);
		assert.match(status.stdout, /Update:\s+succeeded/);
	});
});

// reader#573. install.sh's first update is the only one that runs in the
// operator's shell; every one after it runs in the updater container, against
// the updater_state volume. The directory beside .env keeps the install-time
// verdict forever, so a status that reads it answers "the rollback failed" on a
// box the app, reading the volume, calls up to date.
describe("remit status from a host shell, with a stale record beside .env", () => {
	function box(scenario = {}) {
		const b = sandbox({
			operatorShell: true,
			scenario: { probe: "ok", ...scenario },
		});
		writeRecord(b.updaterState, {
			outcome: "succeeded",
			message: "reader is on v0.2.16.",
			latestVersion: "v0.2.16",
			lastCheckedAt: "2026-08-01T09:20:11Z",
		});
		writeRecord(join(b.deployment, ".update"), {
			outcome: "rollbackFailed",
			message: "the database migration did not run.",
			latestVersion: "v0.2.0",
			lastCheckedAt: "2026-07-25T06:17:55Z",
		});
		return b;
	}

	it("reports the run the updater recorded on its volume", () => {
		const status = box().run(["status"]);
		assert.equal(status.status, 0, status.stderr);
		assert.match(status.stdout, /Update:\s+succeeded/);
		assert.match(status.stdout, /up to date \(v0\.2\.16/);
		assert.ok(!status.stdout.includes("rollbackFailed"), status.stdout);
	});

	// A deployment installed before the updater existed has no volume, and the
	// directory is then the only record there is.
	it("falls back to the directory when there is no updater volume", () => {
		const status = box({ updater_volume: "absent" }).run(["status"]);
		assert.equal(status.status, 0, status.stderr);
		assert.match(status.stdout, /Update:\s+rollbackFailed/);
		assert.match(status.stdout, /up to date \(v0\.2\.0/);
	});
});

describe("a box with nothing running and nothing on the volume", () => {
	it("takes the plain path — there is nothing to snapshot or roll back to", () => {
		const box = sandbox({ scenario: { probe: "ok", services: "" } });
		const result = box.run(["update"]);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(!box.log().includes("run snapshot"));
		// install.sh's first update must not silently adopt the manifest's
		// version over the tag it was asked to install.
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
	});
});

// reader#495. `remit down` leaves the accounts and the mail where they are, so
// the box that comes back to `remit update` has an old version to snapshot and
// something to roll back to — everything the plain path is written for the
// absence of. Routing on running containers sent that update down the plain
// path, which migrated a real database with no snapshot behind it.
describe("a stopped box that still holds a database", () => {
	const box = sandbox({
		realDb: true,
		scenario: {
			probe: "ok",
			services: "",
			migrate_exit: 0,
			target_schema: 9,
		},
		manifest: { ...MANIFEST, schemaVersion: 9 },
	});
	const result = box.run(["update", "--tag", "v1.6.0"]);

	it("snapshots the database before the migration runs", () => {
		assert.equal(result.status, 0, result.stderr);
		const snapshot = box.snapshotDb();
		assert.equal(schemaTotal(snapshot), 8);
		assert.equal(hasFilterMoveColumn(snapshot), false);
	});

	it("commits on the gate's verdict", () => {
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.6.0");
		assert.equal(box.liveSchema(), 9);
	});

	// The end state the same command reached before this branch existed: the
	// plain path's unscoped `up -d` left the whole always-on stack serving.
	// Committing on the gate set alone reports success while the origin refuses
	// connections, and leaves queue and backend up under `unless-stopped` on a
	// box the operator had taken down.
	it("leaves the whole always-on stack up, not the gate set alone", () => {
		assert.deepEqual(box.running(), WHOLE_STACK);
	});

	it("holds the updater back, because it replaces itself last", () => {
		const commit = box
			.log()
			.split("\n")
			.filter((l) => l.startsWith("compose up -d ") && l.includes("apisix"));
		assert.equal(commit.length, 1);
		const started = commit[0].split(/\s+/);
		assert.ok(started.includes("scheduler"));
		assert.ok(!started.includes("updater"));
	});
});

describe("a stopped box whose migration fails", () => {
	const box = sandbox({
		realDb: true,
		scenario: {
			probe: "ok",
			services: "",
			migrate_exit: 1,
			migrate_exit2: 0,
		},
	});
	box.run(["update", "--tag", "v1.6.0"]);

	it("rolls back rather than leaving .env naming the new tag", () => {
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(box.log().includes("run restore"), box.log());
	});

	it("restores the database it snapshotted", () => {
		assert.deepEqual(box.liveBytes(), readFileSync(box.snapshotDb()));
		assert.equal(box.liveSchema(), 8);
	});

	it("leaves the whole always-on stack up on the previous tag", () => {
		assert.deepEqual(box.running(), WHOLE_STACK);
	});
});

describe("a stopped box where a held-back service will not start", () => {
	// Bringing the whole always-on stack back is more than the running-stack path
	// ever had to do, and caddy binds :80 and :443 — ports something else may have
	// taken while the box was down. The gate has already passed, so the tag and
	// the database stand and there is nothing to roll back; what the operator must
	// not get is a run that goes quiet with the app plane missing.
	const box = sandbox({
		realDb: true,
		scenario: {
			probe: "ok",
			services: "",
			migrate_exit: 0,
			up_fail: "caddy",
		},
	});
	const result = box.run(["update", "--tag", "v1.6.0"]);

	it("names what did not start and the command that finishes the run", () => {
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /caddy/);
		assert.match(result.stderr, /update --recover/);
	});

	it("leaves the run recoverable rather than recording an outcome", () => {
		assert.equal(box.stateJson().run.outcome, null);
		assert.match(box.breadcrumb(), /phase=committing/);
	});
});

describe("a stopped box whose volume cannot be read", () => {
	// Neither road is safe from here: the plain path would migrate a database
	// that may be there with no snapshot, and the atomic path would try to
	// snapshot one that may not be. install.sh's first `remit update` meets this
	// on a rate-limited registry or a busy daemon, so it has to say so rather
	// than pick.
	const box = sandbox({
		realDb: true,
		scenario: { probe: "ok", services: "", data_probe: "fail" },
	});
	const result = box.run(["update", "--tag", "v1.6.0"]);

	it("refuses, saying what failed and what to retry", () => {
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /could not be read/);
		assert.match(result.stderr, /remit update/);
	});

	it("changes nothing", () => {
		assert.equal(box.dotenv("REMIT_TAG"), "v1.0.0");
		assert.ok(!box.log().includes("compose pull"), box.log());
		assert.ok(!box.log().includes("run snapshot"), box.log());
		assert.deepEqual(box.running(), []);
	});
});

describe("the check reports schema versions, never a computed flag", () => {
	// Versions cross the seam: the running instance's currentSchemaVersion and
	// the target release's schemaVersion. A consumer derives "runs a migration"
	// as schemaVersion > currentSchemaVersion; nothing here decides it.
	it("carries both versions when the manifest names a higher schema", () => {
		const box = sandbox({
			scenario: { probe: "ok", current_schema: 8 },
			manifest: { ...MANIFEST, schemaVersion: 9 },
		});
		box.run(["update", "--check"]);
		const state = box.stateJson();
		assert.equal(state.currentSchemaVersion, 8);
		assert.equal(state.check.schemaVersion, 9);
	});

	it("carries equal versions when the manifest is at the running schema", () => {
		const box = sandbox({
			scenario: { probe: "ok", current_schema: 8 },
			manifest: { ...MANIFEST, schemaVersion: 8 },
		});
		box.run(["update", "--check"]);
		const state = box.stateJson();
		assert.equal(state.currentSchemaVersion, 8);
		assert.equal(state.check.schemaVersion, 8);
	});

	it("omits the target schema for a manifest published without one", () => {
		const box = sandbox({
			scenario: { probe: "ok", current_schema: 8 },
			manifest: MANIFEST,
		});
		box.run(["update", "--check"]);
		const state = box.stateJson();
		assert.equal(state.currentSchemaVersion, 8);
		assert.ok(!("schemaVersion" in state.check));
	});

	it("omits the running schema when the database has none to read", () => {
		const box = sandbox({
			scenario: { probe: "ok" },
			manifest: { ...MANIFEST, schemaVersion: 9 },
		});
		box.run(["update", "--check"]);
		assert.ok(!("currentSchemaVersion" in box.stateJson()));
	});

	it("reads a database with no migration tables as schema 0, not unknown", () => {
		// A real database file that exists but has never been migrated: every
		// __drizzle_migrations_* count falls through the sqlite3 fallback to 0, so
		// the instance is a pre-migration one at schema 0 that every release
		// migrates — not an absent, unknown version.
		const box = sandbox({
			realDb: true,
			bareDb: true,
			scenario: { probe: "ok" },
			manifest: { ...MANIFEST, schemaVersion: 9 },
		});
		box.run(["update", "--check"]);
		assert.equal(box.stateJson().currentSchemaVersion, 0);
	});

	it("preserves the target schema across a re-check after a version change", () => {
		const box = sandbox({
			scenario: { probe: "ok", current_schema: 8 },
			manifest: { ...MANIFEST, schemaVersion: 9 },
		});
		box.run(["update"]);
		// The update commits, recheck_availability rewrites the check block, and
		// schemaVersion must survive that round-trip rather than being dropped.
		assert.equal(box.stateJson().check.schemaVersion, 9);
	});
});

describe("remit update — a release that runs a schema migration", () => {
	const box = sandbox({
		realDb: true,
		scenario: { probe: "ok", migrate_exit: 0, target_schema: 9 },
		manifest: { ...MANIFEST, schemaVersion: 9 },
	});
	const preSchema = box.liveSchema();
	const result = box.run(["update"]);
	const snapshot = box.snapshotDb();

	it("starts from the seeded schema version", () => {
		assert.equal(preSchema, 8);
	});

	it("succeeds and records both schema versions", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.equal(box.stateJson().currentSchemaVersion, 8);
		assert.equal(box.stateJson().check.schemaVersion, 9);
	});

	it("snapshots the database before the migration runs", () => {
		// The snapshot is the old schema without the new column, proving it was
		// taken before the migrate step lifted the live database.
		assert.equal(schemaTotal(snapshot), 8);
		assert.equal(hasFilterMoveColumn(snapshot), false);
	});

	it("leaves the live database migrated to the new version", () => {
		assert.equal(box.liveSchema(), 9);
		assert.equal(box.liveHasFilterMove(), true);
	});
});

describe("remit update — a migrating release whose gate fails", () => {
	const box = sandbox({
		realDb: true,
		scenario: {
			probe: "fail",
			probe2: "ok",
			migrate_exit: 0,
			target_schema: 9,
			target_schema2: 8,
		},
		manifest: { ...MANIFEST, schemaVersion: 9 },
	});
	box.run(["update"]);
	const snapshot = box.snapshotDb();

	it("rolls back", () => {
		assert.equal(box.stateJson().run.outcome, "rolledBack");
	});

	it("byte-restores the pre-migration database", () => {
		// The live file is byte-for-byte the snapshot taken before the migration,
		// read before any assertion opens the database.
		assert.deepEqual(box.liveBytes(), readFileSync(snapshot));
		assert.equal(box.liveSchema(), 8);
		assert.equal(box.liveHasFilterMove(), false);
	});
});

// `remit check-categories` (#321). The wrapper is the self-host interface, so the
// read-only mode of the migrate entrypoint gets a command rather than a compose
// line in the README — and the command is where --no-deps lives, because without
// it `compose run` starts volume-init, which chowns the data volumes as root.
describe("remit check-categories", () => {
	const box = sandbox({ scenario: { probe: "ok" } });
	const result = box.run(["check-categories"]);

	it("runs the migrate entrypoint's read-only mode", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.ok(
			box
				.log()
				.split("\n")
				.some(
					(line) =>
						line ===
						"compose run --rm --no-deps migrate node migrate.mjs --check",
				),
			`no read-only migrate run in:\n${box.log()}`,
		);
	});

	it("starts no dependency, so nothing writes on the operator's behalf", () => {
		const log = box.log();
		assert.ok(!log.includes("compose up"), log);
		assert.ok(!log.includes("volume-init"), log);
	});

	it("takes no arguments", () => {
		const rejected = box.run(["check-categories", "--repair"]);
		assert.equal(rejected.status, 1);
		assert.match(rejected.stderr, /takes no arguments/);
	});
});

describe("shellcheck", () => {
	it("is clean on the wrapper under POSIX sh", () => {
		const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
		if (probe.error) return; // not installed here; CI runs it as its own step
		const result = spawnSync("shellcheck", ["-s", "sh", REMIT, SNAPSHOT_LIB], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout);
	});
});

// reader#273: in the updater container this wrapper runs as root against the
// bind-mounted deployment directory, so a naive rewrite of .env lands it
// root:root and locks the host user out of their own file. set_var must capture
// the original owner and mode and restore them onto the replacement before the
// rename. The suite runs as one uid, so a real uid change cannot be exercised;
// what is proved instead is that the wrapper *emits* the chown/chmod that carry
// the original owner and mode onto the temp file — the exact commands that are
// no-ops here and load-bearing under root. The pre-fix wrapper emits neither.
describe("set_var preserves .env ownership (reader#273)", () => {
	function ownershipSandbox({ statFails = false } = {}) {
		const dir = mkdtempSync(join(TMP_ROOT, "remit-ownership-"));
		sandboxes.push(dir);
		const deployment = join(dir, "deployment");
		const bin = join(dir, "bin");
		mkdirSync(deployment, { recursive: true });
		mkdirSync(bin, { recursive: true });

		const envPath = join(deployment, ".env");
		writeFileSync(
			envPath,
			["REMIT_TAG=v1.0.0", "PUBLIC_ORIGIN=https://mail.example.test", ""].join(
				"\n",
			),
		);
		// A mode that is not the write's own 077 default, so preserving it is a
		// visible act rather than a coincidence.
		chmodSync(envPath, 0o640);
		// Captured before the rewrite: the shims below do not apply the mode, so
		// the file's mode after set_var is the temp file's, not the original's.
		const before = statSync(envPath);
		const original = {
			uid: before.uid,
			gid: before.gid,
			mode: (before.mode & 0o777).toString(8),
		};

		// chown/chmod shims that record their arguments rather than apply them:
		// under this test's single uid an applied chown is a no-op, so the emitted
		// command is the only observable proof the wrapper restores ownership.
		const ownerLog = join(dir, "owner.log");
		for (const name of ["chown", "chmod"]) {
			writeExecutable(
				join(bin, name),
				`#!/bin/sh\nprintf '${name} %s\\n' "$*" >> "${ownerLog}"\nexit 0\n`,
			);
		}

		// A stat that is absent or broken must not abort the rewrite under set -eu:
		// shim it to fail so the capture yields nothing and the restore is skipped.
		if (statFails) {
			writeExecutable(join(bin, "stat"), "#!/bin/sh\nexit 127\n");
		}

		const result = spawnSync(
			"sh",
			["-c", '. "$0"\nset_var REMIT_TAG v9.9.9', REMIT],
			{
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					REMIT_LIB_ONLY: "1",
					REMIT_DIR: deployment,
				},
				encoding: "utf8",
			},
		);

		return {
			result,
			envPath,
			original,
			ownerLines: existsSync(ownerLog)
				? readFileSync(ownerLog, "utf8").trim().split("\n").filter(Boolean)
				: [],
			dotenv(key) {
				const line = readFileSync(envPath, "utf8")
					.split("\n")
					.find((l) => l.startsWith(`${key}=`));
				return line ? line.slice(key.length + 1) : null;
			},
		};
	}

	it("rewrites the value it was asked to", () => {
		const box = ownershipSandbox();
		assert.equal(box.result.status, 0, box.result.stderr);
		assert.equal(box.dotenv("REMIT_TAG"), "v9.9.9");
		assert.equal(box.dotenv("PUBLIC_ORIGIN"), "https://mail.example.test");
	});

	it("restores the original owner onto the replacement before the rename", () => {
		const box = ownershipSandbox();
		const { uid, gid } = box.original;
		const chown = box.ownerLines.find((l) => l.startsWith("chown "));
		assert.ok(chown, `no chown emitted:\n${box.ownerLines.join("\n")}`);
		// The captured owner, applied to the temp file — never the live .env, so
		// the restore happens before the atomic rename.
		assert.equal(chown, `chown ${uid}:${gid} ${box.envPath}.tmp`);
	});

	it("restores the original mode onto the replacement", () => {
		const box = ownershipSandbox();
		const chmod = box.ownerLines.find((l) => l.startsWith("chmod "));
		assert.ok(chmod, `no chmod emitted:\n${box.ownerLines.join("\n")}`);
		assert.equal(chmod, `chmod ${box.original.mode} ${box.envPath}.tmp`);
	});

	// Under set -eu a stat that cannot run must not abort set_var before the tag
	// is written: the capture is best-effort, so an unreadable owner degrades to
	// the pre-fix behaviour (the rewrite lands, root-owned) rather than aborting
	// the whole update with no tag change and no message.
	it("still rewrites the value when stat is unavailable", () => {
		const box = ownershipSandbox({ statFails: true });
		assert.equal(box.result.status, 0, box.result.stderr);
		assert.equal(box.dotenv("REMIT_TAG"), "v9.9.9");
		assert.deepEqual(
			box.ownerLines,
			[],
			`no owner should be restored when stat fails:\n${box.ownerLines.join("\n")}`,
		);
	});
});

// The restore reads a caller-supplied path into a local, and this wrapper has
// no scoping: a local named for something a caller also uses is that caller's
// variable. run_update holds the release being installed in `_target` across
// every set_var, so a restore that borrowed the name left every phase after
// the tag write naming an .env.tmp path instead of the version.
describe("restoring an owner leaves its caller's variables alone", () => {
	it("does not write through the name run_update holds the release in", () => {
		const dir = mkdtempSync(join(TMP_ROOT, "remit-rom-"));
		sandboxes.push(dir);
		const file = join(dir, "subject");
		writeFileSync(file, "");
		const run = spawnSync(
			"sh",
			[
				"-c",
				[
					'. "$0"',
					"_target=v1.5.0",
					'restore_owner_mode "$1" "$(owner_mode_of "$1")"',
					'printf %s "$_target"',
				].join("\n"),
				REMIT,
				file,
			],
			{ env: { ...process.env, REMIT_LIB_ONLY: "1" }, encoding: "utf8" },
		);
		assert.equal(run.status, 0, run.stderr);
		assert.equal(run.stdout, "v1.5.0");
	});
});

async function waitFor(predicate, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for the wrapper to reach the phase");
}

// The lock is free once a non-blocking flock on it succeeds — the same acquire
// the wrapper does, so it is the exact observable state recovery needs, not a
// guess at how long reaping takes.
async function waitForLockFree(lockPath) {
	await waitFor(() => {
		const probe = spawnSync("sh", ["-c", `exec 9>"${lockPath}"; flock -n 9`]);
		return probe.status === 0;
	});
}
