// `remit status` on a tunnelled deployment (reader#567 D13).
//
// The hostname of a tunnel deployment resolves to the provider's edge, so the
// line every other mode prints — whether the name reaches this box — is one
// this mode can never satisfy and would report as a fault forever. What can
// actually fail is the agent's connection to that edge, and that is what has to
// be on the screen instead.
//
// Driven against the same docker stand-in the update and profile suites use.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
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

// A port nothing listens on, so the reachability probe fails at once instead of
// spending its timeout on a name that does not resolve.
const ORIGIN = "https://127.0.0.1:1";

const RUNNING = "queue backend caddy web apisix";

function sandbox({
	mode = "tunnel",
	agent = true,
	ready = "connected",
	env = [],
} = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-status-tunnel-"));
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
			`TLS_MODE=${mode}`,
			...env,
			"",
		].join("\n"),
	);

	const services = agent ? `${RUNNING} tunnel` : RUNNING;
	writeFileSync(
		join(fake, "scenario"),
		[`services=${services}`, `all_services=${services} migrate`, ""].join("\n"),
	);
	let seq = 0;
	for (const svc of services.split(" ")) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		writeFileSync(join(fake, `up-${svc}`), "");
	}
	writeFileSync(join(fake, "seq"), String(seq));
	// What the readiness probe inside caddy printed. The wrapper reads that one
	// word and nothing else, which is what lets a stand-in stand in for it.
	writeFileSync(join(fake, "exec-out"), ready);

	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);

	return spawnSync("sh", [REMIT, "status"], {
		encoding: "utf8",
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: dir,
			FAKE_DOCKER_DIR: fake,
			REMIT_DIR: deployment,
		},
	});
}

describe("remit status on a tunnelled deployment", () => {
	const run = sandbox();

	it("succeeds", () => {
		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
	});

	it("names the mode and where the hostname answers", () => {
		assert.match(run.stdout, /^Mode: +tunnel/m);
		assert.match(run.stdout, /edge/);
	});

	it("drops the resolves-to-this-box line this mode can never satisfy", () => {
		assert.ok(
			!/This box does not hold that/.test(run.stdout),
			`the edge's address was reported as a fault:\n${run.stdout}`,
		);
		assert.ok(!/^Address:/m.test(run.stdout), run.stdout);
	});

	it("reports the agent's connection to the edge in its place", () => {
		assert.match(run.stdout, /^Tunnel: +agent connected to the edge$/m);
	});

	it("still says whether the public path answers", () => {
		assert.match(run.stdout, /^Serving:.*through the edge$/m);
	});
});

describe("what remit status says when the tunnel is down", () => {
	it("names an agent that is not running", () => {
		const run = sandbox({ agent: false });
		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(run.stdout, /^Tunnel: +agent not running/m);
	});

	it("separates an agent that runs but reaches nobody", () => {
		const run = sandbox({ ready: "down" });
		assert.match(run.stdout, /^Tunnel: +agent running, no connection/m);
		assert.match(run.stdout, /remit logs tunnel/);
	});

	it("says so rather than guessing when it cannot ask", () => {
		const run = sandbox({ ready: "unchecked" });
		assert.match(
			run.stdout,
			/^Tunnel: +agent running, connection not checked$/m,
		);
	});
});

describe("remit status on every other mode", () => {
	it("still reports how the origin resolves", () => {
		const run = sandbox({ mode: "internal" });
		assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
		assert.match(run.stdout, /^Address:/m);
		assert.ok(!/^Tunnel:/m.test(run.stdout), run.stdout);
		assert.ok(!/^Mode:/m.test(run.stdout), run.stdout);
	});
});
