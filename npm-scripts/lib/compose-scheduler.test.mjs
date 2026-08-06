// The periodic mailbox-sync scheduler, and the thresholds that read its output.
//
// A standalone deployment has no EventBridge. Every sync trigger other than this
// service is user-driven — loading the client, pressing sync, connecting an
// account — so a stack that resolves without it stops fetching mail the moment
// the last browser tab closes, while every container reports healthy.
// That is what the first suite here is for, and it is asserted
// against what `docker compose config` resolves rather than against the YAML
// source: a service commented out, moved behind a profile, or dropped from the
// deployed file reads the same to a regex and not to compose.
//
// The second suite is the reconciliation. The scheduler's two intervals decide
// how high a healthy account's sync age climbs; `DOCTOR_SYNC_AGE_MAX_SECONDS`
// decides when that height is reported as a stall. Both numbers are computed
// here by the code that will really read them — the scheduler's own config
// module over the resolved scheduler environment, the checker's own loader over
// the resolved checker environment — so neither side is retyped into this file
// and a change to either default is measured against the other.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");
const COMPOSE = join(DEPLOY, "docker-compose.sqlite.yml");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// A missing tool is a fact about a developer's machine and never about CI:
// skipping there would leave a suite that reports green without having resolved
// anything.
const COMPOSE_OK = (() => {
	if (
		spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status ===
		0
	) {
		return true;
	}
	if (process.env.CI)
		throw new Error(
			"no `docker compose` on this machine — this suite needs it",
		);
	console.log("skipping: no `docker compose` on this machine");
	return false;
})();

// Compose reads the process environment as well as --env-file, and the ambient
// one would decide the answer on some machines and not others.
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

// What an operator's .env holds and nothing more. Every value these suites are
// about is absent from it on purpose: the defaults are the subject.
const BASE_ENV = [
	"REMIT_TAG=v1.0.0",
	"PUBLIC_ORIGIN=https://mail.example.test",
	"REMIT_DEPLOY_DIR=/opt/reader",
];

function run(lines, args) {
	const dir = mkdtempSync(join(TMP_ROOT, "compose-scheduler-"));
	sandboxes.push(dir);
	copyFileSync(COMPOSE, join(dir, "docker-compose.sqlite.yml"));
	writeFileSync(join(dir, ".env"), `${lines.join("\n")}\n`);
	const result = spawnSync(
		"docker",
		[
			"compose",
			"-f",
			join(dir, "docker-compose.sqlite.yml"),
			"--project-directory",
			dir,
			"--env-file",
			join(dir, ".env"),
			"config",
			...args,
		],
		{ encoding: "utf8", env: CLEAN_ENV },
	);
	assert.equal(
		result.status,
		0,
		`docker compose config failed: ${result.stderr || result.stdout}`,
	);
	return result.stdout;
}

const resolved = (lines = BASE_ENV) =>
	JSON.parse(run(lines, ["--format", "json"]));
const services = (lines = BASE_ENV) =>
	run(lines, ["--services"]).split("\n").filter(Boolean).sort();

// The file an operator copies, taken verbatim and given only the two values
// install.sh fills in. A test that retypes the queue URLs would prove nothing
// about what the template hands the container.
const TEMPLATE_ENV = [
	readFileSync(join(DEPLOY, "remit.env.template"), "utf8"),
	"PUBLIC_ORIGIN=https://mail.example.test",
	"REMIT_DEPLOY_DIR=/opt/reader",
];

describe("the stack fetches mail with no browser open", {
	skip: !COMPOSE_OK,
}, () => {
	it("starts a scheduler, and starts it for every operator", () => {
		assert.ok(
			services().includes("scheduler"),
			"a deployment with no scheduler stops syncing when the last tab closes",
		);
	});

	it("runs the same tick a managed deployment schedules, from the worker image", () => {
		const scheduler = resolved().services.scheduler;
		assert.match(scheduler.image, /\/imap-worker:/);
		assert.deepEqual(
			scheduler.command,
			["node", "scheduler.mjs"],
			"one scheduling implementation, reached as an alternate entrypoint",
		);
	});

	it("is handed the relational store it reads the account list from", () => {
		const scheduler = resolved().services.scheduler;
		assert.equal(scheduler.environment.DATA_BACKEND, "sqlite");
		assert.equal(scheduler.environment.SQLITE_DB_PATH, "/data/sqlite/remit.db");
		assert.deepEqual(
			scheduler.volumes.map((volume) => `${volume.source}:${volume.target}`),
			["sqlite_data:/data/sqlite", "heartbeat:/data/heartbeat"],
			"it enqueues work and talks to no mail server, so it needs no message storage",
		);
	});

	it("runs under the heap ceiling every other Node service runs under", () => {
		assert.equal(
			resolved().services.scheduler.environment.NODE_OPTIONS,
			"--max-old-space-size=512",
		);
	});

	it("waits for the queue it enqueues onto and the schema it reads", () => {
		assert.deepEqual(resolved().services.scheduler.depends_on, {
			queue: { condition: "service_healthy", required: true },
			migrate: { condition: "service_completed_successfully", required: true },
			"volume-init": {
				condition: "service_completed_successfully",
				required: true,
			},
		});
	});

	it("comes back after a crash or a reboot", () => {
		assert.equal(resolved().services.scheduler.restart, "unless-stopped");
	});

	// The image bakes the imap-worker's check, which reads imap-worker.* files
	// this entrypoint never writes. It gets its own prefix rather than inheriting
	// that one, and the compose service replaces the check to match — the doctor
	// reads these files per service, so a scheduler beating into the workers'
	// prefix would report a wedged worker as alive.
	it("beats under a prefix of its own", () => {
		assert.equal(
			resolved().services.scheduler.environment.WORKER_HEARTBEAT_PREFIX,
			"/data/heartbeat/scheduler",
		);
	});

	// The entrypoint reads both: the producer's queue URL, and the one the data
	// client demands before it will hand over an account repository. A variable
	// the template does not carry is a container that crash-loops on the queue
	// the whole service exists to write to.
	it("gets the queue configuration the template ships", () => {
		const scheduler = resolved(TEMPLATE_ENV).services.scheduler;
		for (const name of ["SQS_QUEUE_URL", "SQS_QUEUE_URL_MAILBOXES"]) {
			assert.match(
				scheduler.environment[name] ?? "",
				/^http:\/\/queue:9324\//,
				`${name} must reach the queue sidecar`,
			);
		}
	});
});

// The check the container will really run, run here. A healthcheck asserted as
// a string proves it was typed, not that it answers — and a check that cannot
// fail is worse than none, because `docker compose up --wait` would then report
// a dead scheduler as ready. The only thing rewritten is the directory it looks
// in, so what executes below is the deployment's own script.
const runHealthcheck = (directory, environment) => {
	const [command, binary, flag, script] =
		resolved().services.scheduler.healthcheck.test;
	assert.deepEqual([command, binary, flag], ["CMD", "node", "-e"]);
	return spawnSync(
		"node",
		["-e", script.replace("'/data/heartbeat'", JSON.stringify(directory))],
		{ encoding: "utf8", env: { ...CLEAN_ENV, ...environment } },
	).status;
};

// Written the way the runner writes it: one file, named for the loop, under the
// prefix the compose service hands the container.
const heartbeatDir = (ageSeconds) => {
	const dir = mkdtempSync(join(TMP_ROOT, "scheduler-heartbeat-"));
	sandboxes.push(dir);
	if (ageSeconds !== undefined) {
		const file = join(dir, "scheduler.tick");
		writeFileSync(file, `${new Date().toISOString()}\n`);
		const when = new Date(Date.now() - ageSeconds * 1000);
		utimesSync(file, when, when);
	}
	return dir;
};

describe("a scheduler that stopped ticking reports it", {
	skip: !COMPOSE_OK,
}, () => {
	const environment = resolved().services.scheduler.environment;
	const tick = Number(environment.MAILBOX_SYNC_TICK_INTERVAL_SECONDS);

	it("passes while the tick loop is turning", () => {
		assert.equal(runHealthcheck(heartbeatDir(1), environment), 0);
	});

	it("fails once the beats stop", () => {
		assert.equal(runHealthcheck(heartbeatDir(tick * 4), environment), 1);
	});

	// The two states a check that cannot look can be in. Reporting either as
	// healthy is the failure the workers' own comment names.
	it("fails when there is no file, and when there is no directory", () => {
		assert.equal(runHealthcheck(heartbeatDir(undefined), environment), 1);
		assert.equal(runHealthcheck(join(TMP_ROOT, "absent"), environment), 1);
	});

	// The workers hardcode 420 s because their bound is a socket timeout. This
	// one is a knob, so the threshold has to move with it or an operator who
	// slows the tick gets a permanently unhealthy container.
	it("takes its staleness threshold from the tick it is configured with", () => {
		const aged = heartbeatDir(tick * 2 + 30);
		assert.equal(runHealthcheck(aged, environment), 0);
		assert.equal(
			runHealthcheck(aged, {
				...environment,
				MAILBOX_SYNC_TICK_INTERVAL_SECONDS: String(Math.floor(tick / 4)),
			}),
			1,
		);
	});
});

// The scheduler's own config module and the checker's own loader, imported
// rather than restated. A default that moves in either package moves the number
// this suite compares.
const { getTickIntervalMs, getOfflineIntervalMs } = await import(
	join(ROOT, "packages", "imap-worker", "src", "scheduler", "config.ts")
);
const { loadConfig } = await import(
	join(ROOT, "packages", "doctor", "src", "config.ts")
);

describe("a healthy account does not read as a stalled one", {
	skip: !COMPOSE_OK,
}, () => {
	const config = resolved();
	const tick = getTickIntervalMs(config.services.scheduler.environment) / 1000;
	const offline =
		getOfflineIntervalMs(config.services.scheduler.environment) / 1000;
	const doctor = loadConfig(config.services.doctor.environment);

	// An account becomes due once its last sync is `offline` old, and a tick is
	// what notices — so the age a healthy account climbs to before it is fetched
	// again is the threshold plus one tick of sampling lag. The round itself adds
	// to that; the margin below is what covers it.
	const peakHealthyAge = offline + tick;

	it("takes both intervals from what the containers will actually read", () => {
		assert.ok(tick > 0 && offline > 0);
		assert.ok(
			tick * 3 <= offline,
			`the tick is the sampling rate, not the sync rate: ${tick}s against a ${offline}s threshold`,
		);
	});

	it("puts the stall threshold above the height of a healthy sawtooth", () => {
		assert.ok(
			doctor.syncAgeMaxSeconds > peakHealthyAge,
			`accounts that are fine reach ${peakHealthyAge}s every cycle, and are reported stalled at ${doctor.syncAgeMaxSeconds}s`,
		);
	});

	it("leaves room for a round that fails and is retried", () => {
		assert.ok(
			doctor.syncAgeMaxSeconds >= peakHealthyAge * 2,
			`a single failed round takes a healthy account to ${peakHealthyAge * 2}s, under a ${doctor.syncAgeMaxSeconds}s threshold`,
		);
	});

	// The other direction. A threshold raised far enough to be quiet stops being
	// the signal that says mail is not arriving.
	it("still names a genuinely stalled account within a useful window", () => {
		assert.ok(
			doctor.syncAgeMaxSeconds <= 2 * 60 * 60,
			`mail silently not arriving for ${doctor.syncAgeMaxSeconds}s is the outcome this signal exists to prevent`,
		);
	});

	it("holds an authentication failure open past the retry that follows it", () => {
		assert.ok(
			doctor.authFailureHoldSeconds > offline,
			"a gap between two retry bursts would otherwise read as a recovery",
		);
		assert.equal(
			doctor.authFailureHoldSeconds,
			doctor.syncAgeMaxSeconds,
			"equal windows are what buy a single recovery message",
		);
	});

	it("reads the checker's threshold from the checker's own default", () => {
		assert.equal(
			config.services.doctor.environment.DOCTOR_SYNC_AGE_MAX_SECONDS,
			"",
			"the compose file passes this through unset so one default governs",
		);
	});
});

describe("the documented cadence knobs reach the scheduler", {
	skip: !COMPOSE_OK,
}, () => {
	const tuned = resolved([
		...BASE_ENV,
		"MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS=1800",
		"MAILBOX_SYNC_TICK_INTERVAL_SECONDS=600",
	]).services.scheduler.environment;

	it("takes an operator's interval from .env", () => {
		assert.equal(getOfflineIntervalMs(tuned) / 1000, 1800);
		assert.equal(getTickIntervalMs(tuned) / 1000, 600);
	});
});
