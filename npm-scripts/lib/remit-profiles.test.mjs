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

function sandbox({ profileRunning = true, stopped = [], scenario = {} } = {}) {
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
			...Object.entries(scenario).map(([k, v]) => `${k}=${v}`),
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
	// A container that exists but is not up: something stopped it, and nothing
	// this wrapper does will start it back.
	for (const svc of stopped) {
		rmSync(join(fake, `up-${svc}`), { force: true });
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
		// The record a restart leaves beside .env so the next one can finish what
		// it started.
		held() {
			try {
				return readFileSync(join(deployment, ".remit-profiles-held"), "utf8")
					.trim()
					.split(/\s+/)
					.filter(Boolean);
			} catch {
				return null;
			}
		},
		fake,
		env,
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

	// The new container id is all the stand-in can see: it says compose was asked
	// to `up` the service, which is what carries a .env edit into a container.
	// That the edit then takes effect is a Compose property, verified against a
	// real deployment rather than here.
	it("asks compose to recreate their containers", () => {
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.notEqual(
				box.cid(service),
				before[service],
				`${service} kept its container, so it is still on the old .env while restart says the file is live`,
			);
		}
	});

	it("keeps no record once everything is back", () => {
		assert.equal(box.held(), null);
	});
});

// A container whose process keeps exiting is `restarting`, never `running`. It
// is also the one an operator is most likely to be restarting the stack to fix,
// so recording only `running` has --hard stop it and then decline to bring it
// back — a container failing loudly every few seconds replaced by one that is
// silently gone.
describe("remit restart --hard restores a crash-looping profile service", () => {
	const box = sandbox({ scenario: { restarting: "victoriametrics" } });
	const result = box.run(["restart", "--hard"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("brings it back rather than leaving it stopped", () => {
		assert.equal(
			box.isUp("victoriametrics"),
			true,
			"a crash-looping container was stopped by --hard and never restored",
		);
	});

	it("restores the healthy profile services with it", () => {
		assert.equal(box.isUp("dozzle"), true);
	});
});

// The window between the stop and the restore is where this command fails:
// `apply` dies on the bad .env edit it exists to apply, and a dropped ssh
// session takes the rest. A shell variable does not survive either.
describe("a restart killed mid-run leaves a record the next one acts on", () => {
	const box = sandbox();
	writeFileSync(join(box.fake, "hang-stop"), "");
	const killed = spawnSync(
		"sh",
		["-c", `timeout -s KILL 2 sh ${REMIT} restart --hard`],
		{ env: box.env, encoding: "utf8" },
	);
	rmSync(join(box.fake, "hang-stop"));

	it("did not get to restore anything", () => {
		assert.notEqual(killed.status, 0, "the run was supposed to be killed");
		assert.equal(box.isUp("victoriametrics"), false);
	});

	it("wrote the record before it stopped anything", () => {
		assert.deepEqual(box.held()?.sort(), ["dozzle", "victoriametrics"]);
	});

	it("the next restart brings them back and clears the record", () => {
		const result = box.run(["restart"]);
		assert.equal(result.status, 0, result.stderr);
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.isUp(service),
				true,
				`${service} stayed down after a second restart, with nothing to say so`,
			);
		}
		assert.equal(box.held(), null);
	});
});

describe("remit down discards a record left by a killed restart", () => {
	const box = sandbox();
	writeFileSync(join(box.fake, "hang-stop"), "");
	spawnSync("sh", ["-c", `timeout -s KILL 2 sh ${REMIT} restart --hard`], {
		env: box.env,
		encoding: "utf8",
	});
	rmSync(join(box.fake, "hang-stop"));
	box.run(["down"]);

	it("clears it, because stopping is what down was asked for", () => {
		assert.equal(box.held(), null);
	});

	it("so the next restart leaves the profile stopped", () => {
		const result = box.run(["restart"]);
		assert.equal(result.status, 0, result.stderr);
		for (const service of PROFILE_SERVICES.split(" ")) {
			assert.equal(
				box.isUp(service),
				false,
				`${service} was restarted after 'remit down' said it would not be`,
			);
		}
	});
});

describe("a profile service the restore cannot start is reported, not swallowed", () => {
	const box = sandbox({ scenario: { up_fail: "victoriametrics" } });
	const result = box.run(["restart", "--hard"]);

	it("still serves, and still says so", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.isUp("backend"), true);
		assert.match(result.stdout, /Open https:\/\/mail\.example\.test/);
	});

	it("names what is down and how to start it", () => {
		assert.match(result.stdout, /did not bring them back/);
		assert.match(result.stdout, /victoriametrics/);
		assert.match(result.stdout, /--profile observability up -d/);
	});

	it("keeps the record, so the next restart tries again", () => {
		assert.deepEqual(box.held(), ["victoriametrics"]);
	});
});

describe("remit restart applies .env to a running profile without --hard", () => {
	const box = sandbox();
	const before = box.cid("victoriametrics");
	const result = box.run(["restart"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("asks compose to recreate the running profile container", () => {
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

// The profile is not one container. Restoring what was up while saying nothing
// about what was not is how a deployment sheds the metrics half of the profile
// and keeps reporting that the .env is live.
describe("a half-stopped profile is named, not shed quietly", () => {
	const box = sandbox({ stopped: ["victoriametrics"] });
	const result = box.run(["restart", "--hard"]);

	it("restores the container that was up", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.isUp("dozzle"), true);
	});

	it("does not start the one something stopped on purpose", () => {
		assert.equal(box.isUp("victoriametrics"), false);
	});

	it("says which one is down and how to start it", () => {
		assert.match(result.stdout, /did not bring them back/);
		assert.match(result.stdout, /victoriametrics/);
		assert.match(result.stdout, /--profile observability up -d/);
	});
});

// After 'remit down' every profile container is stopped on purpose, and the
// contract is that restart leaves them that way. Nothing to report.
describe("a stack brought back after remit down says nothing about profiles", () => {
	const box = sandbox();
	box.run(["down"]);
	const result = box.run(["restart"]);

	it("serves again", () => {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(box.isUp("backend"), true);
	});

	it("prints no profile advice", () => {
		assert.doesNotMatch(result.stdout, /did not bring them back/);
		assert.doesNotMatch(result.stdout, /--profile/);
	});
});
