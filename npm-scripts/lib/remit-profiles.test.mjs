// `remit down`, `remit purge` and `remit restart` against a deployment with an
// optional profile turned on (docs/design/standalone-observability.md D13).
//
// Compose hides a service whose profile is inactive from `stop`, `down` and
// `config` — but not from `ps`. A command whose contract is "everything" that
// does not name the profiles acts on the always-on services and reports as
// though it acted on all of them. `remit purge` did exactly that: it printed
// "remit is purged" while dozzle kept running with the docker socket and the
// metrics volume stayed on disk, and its confirmation prompt never named that
// volume at all.
//
// Driven against the same docker stand-in the update suite uses, which models
// that asymmetry rather than assuming it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
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
const FAKES = join(HERE, "remit-test");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const ALWAYS_ON =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker search-index-worker updater";
const PROFILE_SERVICES = "dozzle victoriametrics";

function sandbox({ profileRunning = true } = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-profiles-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	for (const d of [deployment, fake, bin]) mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(
		join(deployment, ".env"),
		["REMIT_TAG=v1.0.0", "PUBLIC_ORIGIN=https://mail.example.test", ""].join(
			"\n",
		),
	);

	const services = profileRunning
		? `${ALWAYS_ON} ${PROFILE_SERVICES}`
		: ALWAYS_ON;
	writeFileSync(
		join(fake, "scenario"),
		[
			`services=${services}`,
			`all_services=${ALWAYS_ON} migrate volume-init`,
			`profile_services=${PROFILE_SERVICES}`,
			"profile_volumes=victoriametrics_data",
			"",
		].join("\n"),
	);

	let seq = 0;
	// migrate has a container but is never up: it is the one-shot every restart
	// gates on, so a sandbox without it fails the gate before reaching anything
	// this suite is about.
	for (const svc of `${services} migrate`.split(" ")) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		if (svc !== "migrate") writeFileSync(join(fake, `up-${svc}`), "");
	}
	writeFileSync(join(fake, "seq"), String(seq));

	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);

	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
	};

	return {
		run(args) {
			return spawnSync("sh", [REMIT, ...args], { env, encoding: "utf8" });
		},
		isUp(service) {
			return existsSync(join(fake, `up-${service}`));
		},
		exists(service) {
			return existsSync(join(fake, `cid-${service}`));
		},
		// A container id that changed means compose recreated the service, which
		// is the only way a .env edit reaches it.
		cid(service) {
			try {
				return readFileSync(join(fake, `cid-${service}`), "utf8");
			} catch {
				return null;
			}
		},
		volumesRemoved() {
			try {
				return readFileSync(join(fake, "volumes-removed"), "utf8")
					.split("\n")
					.filter(Boolean);
			} catch {
				return [];
			}
		},
	};
}

describe("remit down stops the optional profiles too", () => {
	const box = sandbox();
	const result = box.run(["down"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("stops the always-on services", () => {
		assert.equal(box.isUp("backend"), false);
		assert.equal(box.isUp("queue"), false);
	});

	it("stops the profile services, so 'serves nothing' is true", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.isUp(service),
				false,
				`${service} kept serving after 'remit down' said nothing is served`,
			);
		}
	});

	it("names them, because 'remit restart' will not bring them back", () => {
		assert.match(result.stdout, /dozzle victoriametrics/);
		assert.match(result.stdout, /--profile observability up -d/);
	});
});

describe("remit down says nothing extra when no profile is running", () => {
	const box = sandbox({ profileRunning: false });
	const result = box.run(["down"]);

	it("succeeds and stops the stack", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.isUp("backend"), false);
	});

	it("prints no profile advice", () => {
		assert.doesNotMatch(result.stdout, /--profile/);
		assert.doesNotMatch(result.stdout, /Also stopped/);
	});
});

describe("remit purge destroys the optional profiles too", () => {
	const box = sandbox();
	const result = box.run(["purge", "--yes"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("removes the profile containers", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.exists(service),
				false,
				`${service} survived a purge, still holding whatever it mounts`,
			);
		}
	});

	it("removes the profile's volume, not only the always-on ones", () => {
		const removed = box.volumesRemoved();
		assert.ok(
			removed.includes("sqlite_data"),
			"the always-on volumes must still go",
		);
		assert.ok(
			removed.includes("victoriametrics_data"),
			"the metrics volume holds per-account series and must not survive a purge",
		);
	});
});

describe("the purge confirmation lists what purge actually destroys", () => {
	const box = sandbox();
	const result = box.run(["purge"]);

	it("refuses without --yes", () => {
		assert.equal(result.status, 1);
	});

	it("names every volume the project declares, profiles included", () => {
		for (const volume of [
			"sqlite_data",
			"message_storage",
			"queue_data",
			"caddy_data",
			"caddy_config",
			"updater_state",
			"updater_control",
			"victoriametrics_data",
		]) {
			assert.match(
				result.stderr,
				new RegExp(`\\b${volume}\\b`),
				`the operator confirms a purge without being told ${volume} goes with it`,
			);
		}
	});

	it("describes each one rather than listing bare names", () => {
		assert.match(result.stderr, /sqlite_data\s+every account/);
		assert.match(result.stderr, /victoriametrics_data\s+the metrics history/);
	});

	it("touches nothing", () => {
		assert.equal(box.isUp("backend"), true);
		assert.equal(box.isUp("dozzle"), true);
		assert.deepEqual(box.volumesRemoved(), []);
	});
});

describe("remit restart --hard applies .env to the optional profiles too", () => {
	const box = sandbox();
	const before = Object.fromEntries(
		PROFILE_SERVICES.split(" ").map((s) => [s, box.cid(s)]),
	);
	const result = box.run(["restart", "--hard"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("brings the always-on services back", () => {
		assert.equal(box.isUp("backend"), true);
		assert.equal(box.isUp("queue"), true);
	});

	it("leaves the profile services running", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.isUp(service),
				true,
				`${service} was stopped and never came back`,
			);
		}
	});

	it("recreates them, so a changed retention actually reaches them", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.notEqual(
				box.cid(service),
				before[service],
				`${service} kept its container, so it is still on the old .env while restart says the file is live`,
			);
		}
	});
});

describe("remit restart applies .env to a running profile without --hard", () => {
	const box = sandbox();
	const before = box.cid("victoriametrics");
	const result = box.run(["restart"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("recreates the running profile container", () => {
		assert.notEqual(
			box.cid("victoriametrics"),
			before,
			"restart claims the .env is live while VictoriaMetrics runs on the old retention",
		);
		assert.equal(box.isUp("victoriametrics"), true);
	});
});

describe("remit restart --hard starts no profile that was not running", () => {
	const box = sandbox({ profileRunning: false });
	const result = box.run(["restart", "--hard"]);

	it("succeeds and serves", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.isUp("backend"), true);
	});

	it("leaves the optional containers absent", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.exists(service),
				false,
				`${service} was created by a restart on a deployment that never enabled the profile`,
			);
		}
	});
});
