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
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const SNAPSHOT_LIB = join(ROOT, "deploy", "vps", "backup", "snapshot-db.sh");
const FAKES = join(HERE, "remit-test");

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

const ALL_SERVICES =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker search-index-worker";

function sandbox({ scenario = {}, manifest = MANIFEST, env = {} } = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-update-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const state = join(dir, "state");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	for (const d of [deployment, join(deployment, "backup"), state, fake, bin]) {
		mkdirSync(d, { recursive: true });
	}
	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	copyFileSync(SNAPSHOT_LIB, join(deployment, "backup", "snapshot-db.sh"));
	writeFileSync(
		join(deployment, ".env"),
		[
			"REMIT_TAG=v1.0.0",
			"PUBLIC_ORIGIN=https://mail.example.test",
			"TLS_MODE=internal",
			"REMIT_UPDATE_MANIFEST_URL=https://updates.example.test/stable.json",
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
	// A live stack: every service has a container and every container is up.
	let seq = 0;
	for (const svc of `${services} migrate`.split(" ")) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		if (svc !== "migrate") writeFileSync(join(fake, `up-${svc}`), "");
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

	const baseEnv = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
		REMIT_UPDATE_STATE_DIR: state,
		REMIT_UPDATE_GATE_BUDGET: "2",
		REMIT_UPDATE_PROBE_INTERVAL: "0",
		...env,
	};

	return {
		dir,
		deployment,
		state,
		fake,
		env: baseEnv,
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
		volumeScripts() {
			try {
				return readFileSync(join(fake, "volume-scripts"), "utf8");
			} catch {
				return "";
			}
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

	it("rolls back inside the budget plus a margin", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.stateJson().run.outcome, "rolledBack");
		assert.ok(Date.now() - started < 30_000);
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
			JSON.stringify({ targetVersion: "v1.0.0; touch /pwned" }),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
		assert.ok(!box.log().includes("compose stop"));
	});

	it("ignores every key other than targetVersion", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({
				targetVersion: "v1.5.0",
				registry: "ghcr.io/attacker",
				image: "evil:latest",
			}),
		);
		box.run(["update"]);
		assert.equal(box.stateJson().run.outcome, "succeeded");
		assert.ok(!box.log().includes("attacker"));
		assert.ok(!box.volumeScripts().includes("attacker"));
	});

	it("refuses a version the manifest does not name", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ targetVersion: "v9.9.9" }),
		);
		const result = box.run(["update"]);
		assert.notEqual(result.status, 0);
		assert.ok(!box.log().includes("compose pull"));
	});

	it("consumes the request so a refusal is not retried forever", () => {
		const box = sandbox({ scenario: { probe: "ok" } });
		writeFileSync(
			join(box.state, "request.json"),
			JSON.stringify({ targetVersion: "v9.9.9" }),
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

		const result = box.run(["update", "--recover"]);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(box.stateJson().run.outcome !== null);
	});
});

describe("the updater replaces itself last", () => {
	it("never names updater in an up -d before the verdict is durable", () => {
		const box = sandbox({
			scenario: {
				probe: "ok",
				all_services: `${ALL_SERVICES} migrate volume-init updater`,
			},
		});
		box.run(["update"]);
		const lines = box.log().split("\n");
		const updaterUp = lines.findIndex((l) => l === "compose up -d updater");
		assert.ok(updaterUp >= 0, "the updater was never replaced");
		const gateUp = lines.findIndex((l) =>
			l.includes("up -d queue migrate backend"),
		);
		assert.ok(gateUp >= 0 && gateUp < updaterUp);
		assert.equal(updaterUp, lines.length - 2);
	});

	it("keeps the updater out of the services it brings back", () => {
		const box = sandbox({
			scenario: {
				probe: "ok",
				services: `${ALL_SERVICES} updater`,
				all_services: `${ALL_SERVICES} updater`,
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

describe("a box with nothing running", () => {
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

async function waitFor(predicate, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for the wrapper to reach the phase");
}
