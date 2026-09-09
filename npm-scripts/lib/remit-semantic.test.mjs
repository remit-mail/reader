// `remit semantic on|off` (issue #1068).
//
// Semantic search is two things that must not disagree: the
// SEARCH_EMBEDDING_PROVIDER setting in .env, which decides whether anything
// embeds, and the `semantic` compose profile, which decides whether the worker
// that does it is running. A provider with no worker queues work nothing
// drains; a worker with the provider off refuses at startup by design. So this
// suite drives the one command that moves both and asserts they arrived
// together.
//
// The compose file is the real one, not a fixture, and `all_services` is
// deliberately unset in the scenario so `config --services` is resolved out of
// it against the active profiles. That is what makes the assertions about which
// side of the profile boundary `search-index-worker` sits on a statement about
// the deployment rather than about this file.
//
// Driven against the same docker stand-in the update, profile and status suites
// use.
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
const TEMPLATE = join(ROOT, "deploy", "vps", "remit.env.template");
const FAKES = join(HERE, "remit-test");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const WORKER = "search-index-worker";

/** The always-on stack, without the worker this suite turns on and off. */
const ALWAYS_ON =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker doctor scheduler updater";

// A port nothing listens on: `remit status` probes the origin, and a name that
// does not resolve spends its whole timeout budget on every invocation.
const ORIGIN = "https://127.0.0.1:1";

function sandbox({ provider = "off", workerUp = false } = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-semantic-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	for (const d of [deployment, fake, bin]) mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(
		join(deployment, ".env"),
		[
			"REMIT_TAG=v1.0.0",
			`PUBLIC_ORIGIN=${ORIGIN}`,
			`SEARCH_EMBEDDING_PROVIDER=${provider}`,
			"",
		].join("\n"),
	);

	const services = workerUp ? `${ALWAYS_ON} ${WORKER}` : ALWAYS_ON;
	// No `all_services`: `config --services` comes from the compose file above,
	// resolved against the profiles .env activates — which is none of them here.
	writeFileSync(
		join(fake, "scenario"),
		[`services=${services}`, `profile_services=${WORKER}`, ""].join("\n"),
	);

	let seq = 0;
	// migrate has a container and is never up: it is the one-shot every start
	// gates on, and a sandbox without it fails that gate before reaching anything
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
		provider() {
			const line = readFileSync(join(deployment, ".env"), "utf8")
				.split("\n")
				.find((l) => l.startsWith("SEARCH_EMBEDDING_PROVIDER="));
			return line === undefined
				? undefined
				: line.slice("SEARCH_EMBEDDING_PROVIDER=".length);
		},
		// Every occurrence, so a rewrite that appends a second line instead of
		// replacing the first is caught: two values that can disagree is the state
		// this command exists to prevent.
		providerLines() {
			return readFileSync(join(deployment, ".env"), "utf8")
				.split("\n")
				.filter((l) => l.startsWith("SEARCH_EMBEDDING_PROVIDER="));
		},
		// Every docker invocation the run made, in order.
		log() {
			return readFileSync(join(fake, "log"), "utf8");
		},
		// The .env a service was created with, as the stand-in recorded it. A
		// change here is the only way an edit reaches a running container.
		envSeen(service) {
			try {
				return readFileSync(join(fake, `env-seen-${service}`), "utf8");
			} catch {
				return null;
			}
		},
	};
}

describe("remit semantic, with no argument", () => {
	it("reports off, and names the command that changes it", () => {
		const box = sandbox();
		const run = box.run(["semantic"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(run.stdout, /^Semantic search: +off/m);
		assert.match(run.stdout, /remit semantic on/);
	});

	it("says text search is unaffected, because that is the question being asked", () => {
		const run = sandbox().run(["semantic"]);
		assert.match(run.stdout, /^Text search: +on/m);
	});

	it("says what turning it on buys, and where the cost is written down", () => {
		const run = sandbox().run(["semantic"]);
		assert.match(run.stdout, /Organize/);
		assert.match(run.stdout, /filters/);
		assert.match(run.stdout, /README\.md/);
	});

	// The panel needs the typed query embedded and no image in this deployment
	// carries a query embedder, so an operator told "turn it on and Related
	// fills" is being told something untrue. The numbers live in README.md and
	// nowhere else, so a copy of them appearing here is a second source.
	it("does not promise the panel no image here can serve", () => {
		const run = sandbox().run(["semantic"]);
		assert.match(run.stdout, /^Similar messages: +off/m);
		assert.doesNotMatch(run.stdout, /1\.4 GB|1\.36 GB|17 hours|150-190/);
	});

	it("reports the test embedder as off, because its vectors match nothing", () => {
		const run = sandbox({ provider: "deterministic", workerUp: true }).run([
			"semantic",
		]);
		assert.match(run.stdout, /^Semantic search: +off/m);
		assert.match(run.stdout, /deterministic/);
	});

	it("reports on, and which side does the embedding", () => {
		const box = sandbox({ provider: "local", workerUp: true });
		const run = box.run(["semantic"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(run.stdout, /^Semantic search: +on/m);
		assert.match(run.stdout, /^Worker: +search-index-worker running$/m);
	});

	it("names a remote provider rather than claiming a model runs here", () => {
		const run = sandbox({ provider: "bedrock", workerUp: true }).run([
			"semantic",
		]);
		assert.match(run.stdout, /^Semantic search: +on — embedded by bedrock$/m);
	});

	it("changes nothing", () => {
		const box = sandbox();
		box.run(["semantic"]);
		assert.equal(box.provider(), "off");
		assert.equal(box.isUp(WORKER), false);
		assert.equal(box.exists(WORKER), false);
	});
});

describe("remit semantic on", () => {
	const box = sandbox();
	const run = box.run(["semantic", "on"]);

	it("succeeds", () => {
		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
	});

	it("writes the provider, once", () => {
		assert.equal(box.provider(), "local");
		assert.deepEqual(box.providerLines(), ["SEARCH_EMBEDDING_PROVIDER=local"]);
	});

	it("starts the worker, so the setting is not waiting on a container", () => {
		assert.equal(box.isUp(WORKER), true);
	});

	it("recreates the backend, which reads the same setting", () => {
		assert.match(
			box.envSeen("backend") ?? "",
			/SEARCH_EMBEDDING_PROVIDER=local/,
		);
	});

	it("prints the resulting state", () => {
		assert.match(run.stdout, /^Semantic search: +on/m);
		assert.match(run.stdout, /^Worker: +search-index-worker running$/m);
	});
});

describe("remit semantic off", () => {
	const box = sandbox({ provider: "local", workerUp: true });
	const run = box.run(["semantic", "off"]);

	it("succeeds", () => {
		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
	});

	it("writes the provider", () => {
		assert.equal(box.provider(), "off");
	});

	// Stopped, the container is indistinguishable from a profile service the
	// operator enabled and something took down — which is what `remit restart`
	// offers to bring back. Turning semantic search off must not leave the next
	// restart trying to turn it on again.
	it("removes the worker's container rather than stopping it", () => {
		assert.equal(box.isUp(WORKER), false);
		assert.equal(box.exists(WORKER), false);
	});

	it("leaves the always-on stack serving", () => {
		assert.equal(box.isUp("backend"), true);
		assert.equal(box.isUp("imap-worker"), true);
	});

	it("prints the resulting state", () => {
		assert.match(run.stdout, /^Semantic search: +off/m);
	});
});

describe("the profile follows the setting, both ways", () => {
	it("round-trips without a reinstall", () => {
		const box = sandbox();

		box.run(["semantic", "on"]);
		assert.equal(box.provider(), "local");
		assert.equal(box.isUp(WORKER), true);

		box.run(["semantic", "off"]);
		assert.equal(box.provider(), "off");
		assert.equal(box.exists(WORKER), false);

		const back = box.run(["semantic", "on"]);
		assert.equal(back.status, 0, `${back.stdout}${back.stderr}`);
		assert.equal(box.provider(), "local");
		assert.equal(box.isUp(WORKER), true);
	});

	it("brings the worker back on a restart while it is on", () => {
		const box = sandbox();
		box.run(["semantic", "on"]);

		const run = box.run(["restart"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.equal(box.isUp(WORKER), true);
	});

	it("leaves it down on a restart while it is off", () => {
		const box = sandbox();

		const run = box.run(["restart"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.equal(box.isUp(WORKER), false);
		assert.equal(box.exists(WORKER), false);
	});

	// Read out of the compose file, not out of this suite's scenario: `remit
	// down` classifies a running service the unscoped `config --services` does
	// not list as one an optional profile put there. The worker showing up in
	// that report is the compose file declaring `profiles: ["semantic"]`, and the
	// verb rather than a raw --profile line is what actually brings it back.
	it("is a profile service to every other command, named by its verb", () => {
		const box = sandbox({ provider: "local", workerUp: true });

		const run = box.run(["down"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(run.stdout, /search-index-worker/);
		assert.match(run.stdout, /remit semantic on/);
	});
});

// `on` writes `local` over every value that embeds nothing an operator can
// search, and leaves exactly one alone.
describe("remit semantic on, over a value that is not off", () => {
	it("replaces the test embedder", () => {
		const box = sandbox({ provider: "deterministic" });

		const run = box.run(["semantic", "on"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.deepEqual(box.providerLines(), ["SEARCH_EMBEDDING_PROVIDER=local"]);
		assert.equal(box.isUp(WORKER), true);
	});

	it("leaves a remote provider alone rather than pulling a model onto the box", () => {
		const box = sandbox({ provider: "bedrock", workerUp: true });

		const run = box.run(["semantic", "on"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.deepEqual(box.providerLines(), [
			"SEARCH_EMBEDDING_PROVIDER=bedrock",
		]);
	});
});

// An unscoped `compose pull` walks past a service behind an inactive profile,
// so without naming it the one image carrying the model is the one image an
// update leaves at the old tag.
describe("remit update", () => {
	it("pulls the model image while semantic search is on", () => {
		const box = sandbox({ provider: "local", workerUp: true });

		const run = box.run(["update"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(box.log(), /compose pull search-index-worker/);
	});

	it("does not pull it while semantic search is off", () => {
		const box = sandbox();

		const run = box.run(["update"]);

		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(box.log(), /compose pull/);
		assert.ok(
			!box.log().includes("compose pull search-index-worker"),
			"an off instance pulled the model image",
		);
	});
});

describe("remit semantic refuses what it cannot do", () => {
	it("takes on, off, or nothing, and says so", () => {
		const box = sandbox();
		for (const arg of ["local", "true", "bedrock", "--on"]) {
			const run = box.run(["semantic", arg]);
			assert.notEqual(run.status, 0, `'${arg}' was accepted`);
			assert.match(run.stderr, /'on', 'off'/);
			assert.equal(box.provider(), "off");
		}
	});

	it("refuses a second argument", () => {
		const run = sandbox().run(["semantic", "on", "off"]);
		assert.notEqual(run.status, 0);
	});
});

describe("remit status", () => {
	it("reports the provider, so an empty Related panel can be explained", () => {
		const off = sandbox().run(["status"]);
		assert.equal(off.status, 0, `${off.stdout}${off.stderr}`);
		assert.match(off.stdout, /^Semantic: +off/m);

		const on = sandbox({ provider: "local", workerUp: true }).run(["status"]);
		assert.match(on.stdout, /^Semantic: +on/m);
	});
});

describe("the shipped default", () => {
	it("is off in the template every install starts from", () => {
		const line = readFileSync(TEMPLATE, "utf8")
			.split("\n")
			.filter((l) => l.startsWith("SEARCH_EMBEDDING_PROVIDER="));
		assert.deepEqual(line, ["SEARCH_EMBEDDING_PROVIDER=off"]);
	});
});
