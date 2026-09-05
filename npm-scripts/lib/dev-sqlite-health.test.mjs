import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTlsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const LIB = join(LIB_DIR, "dev-sqlite-health.sh");
const PROBE = join(LIB_DIR, "dev-sqlite-tls-probe.mjs");
const TMP_ROOT = join(LIB_DIR, "..", "..", ".tmp");

// The stack's own services, so a rename in the compose file lands here rather
// than leaving the suite green against a service list nobody runs.
const COMPOSE_SERVICES = [
	"elasticmq",
	"migrate",
	"backend",
	"imap-worker",
	"search-index-worker",
	"account-worker",
	"scheduler",
	"web",
];

const STARTED = "2026-09-02T09:00:00Z";

function callShell(script, ...args) {
	return execFileSync(
		"bash",
		["-c", `source "$1"; ${script}`, "dev-sqlite-health", LIB, ...args],
		{ encoding: "utf8" },
	);
}

function fact({
	service,
	status = "running",
	exitCode = 0,
	restarts = 0,
	health = "none",
	policy = "unless-stopped",
	started = STARTED,
}) {
	return [service, status, exitCode, restarts, health, policy, started].join(
		"\t",
	);
}

// A stack in the shape the compose file describes when nothing is wrong: the
// migrator completed, the two services with healthchecks are healthy, the rest
// are running.
function healthyFacts(overrides = {}) {
	return COMPOSE_SERVICES.map((service) => {
		if (service === "migrate") {
			return fact({
				service,
				status: "exited",
				policy: "no",
				...overrides[service],
			});
		}
		if (service === "backend" || service === "web") {
			return fact({ service, health: "healthy", ...overrides[service] });
		}
		return fact({ service, ...overrides[service] });
	}).join("\n");
}

const serviceFailures = (facts, services = COMPOSE_SERVICES.join("\n")) =>
	callShell('dev_sqlite_service_failures "$2" "$3"', services, facts)
		.split("\n")
		.filter(Boolean);

const restartFailures = (facts, limit = "5") =>
	callShell('dev_sqlite_restart_failures "$2" "$3"', facts, limit)
		.split("\n")
		.filter(Boolean);

const staleServices = (facts, since) =>
	callShell('dev_sqlite_stale_services "$2" "$3"', facts, String(since)).trim();

describe("dev_sqlite_service_failures", () => {
	it("passes a stack where every service is up", () => {
		assert.deepEqual(serviceFailures(healthyFacts()), []);
	});

	it("names a service the stack never started", () => {
		const facts = healthyFacts()
			.split("\n")
			.filter((line) => !line.startsWith("scheduler\t"))
			.join("\n");
		assert.deepEqual(serviceFailures(facts), [
			"services: scheduler has no container",
		]);
	});

	it("names a service that exited", () => {
		const facts = healthyFacts({
			"search-index-worker": { status: "exited", exitCode: 1 },
		});
		assert.deepEqual(serviceFailures(facts), [
			"services: search-index-worker is exited, exit code 1",
		]);
	});

	// The incident's vite: holding its port, answering 500, and reported as up by
	// everything that only asks whether the container is running.
	it("names a service that is running but unhealthy", () => {
		const facts = healthyFacts({ web: { health: "unhealthy" } });
		assert.deepEqual(serviceFailures(facts), [
			"services: web is running but unhealthy",
		]);
	});

	it("accepts a healthcheck-less service as up on running alone", () => {
		assert.deepEqual(
			serviceFailures(healthyFacts({ "imap-worker": { health: "none" } })),
			[],
		);
	});

	it("names the migrator when it failed rather than completed", () => {
		const facts = healthyFacts({
			migrate: { status: "exited", exitCode: 1, policy: "no" },
		});
		assert.deepEqual(serviceFailures(facts), [
			"services: migrate is a one-shot that has not completed — exited, exit code 1",
		]);
	});

	it("names the migrator while it is still running", () => {
		const facts = healthyFacts({
			migrate: { status: "running", policy: "no" },
		});
		assert.deepEqual(serviceFailures(facts), [
			"services: migrate is a one-shot that has not completed — running, exit code 0",
		]);
	});

	it("reports every failing service, not just the first", () => {
		const facts = healthyFacts({
			web: { health: "unhealthy" },
			scheduler: { status: "exited", exitCode: 137 },
		});
		assert.deepEqual(serviceFailures(facts), [
			"services: scheduler is exited, exit code 137",
			"services: web is running but unhealthy",
		]);
	});

	it("reports every service when nothing is up at all", () => {
		assert.equal(serviceFailures("").length, COMPOSE_SERVICES.length);
	});
});

describe("dev_sqlite_restart_failures", () => {
	it("passes a stack that is not restarting", () => {
		assert.deepEqual(restartFailures(healthyFacts()), []);
	});

	// The crash loop that ran ~6400 times on `Cannot find package 'tsx'` while
	// every surface still called the stack up.
	it("names a crash-looping service and its count", () => {
		const facts = healthyFacts({
			"search-index-worker": { restarts: 6400 },
		});
		assert.deepEqual(restartFailures(facts), [
			"restarts: search-index-worker has restarted 6400 times, over the limit of 5",
		]);
	});

	it("allows exactly the limit", () => {
		assert.deepEqual(
			restartFailures(healthyFacts({ backend: { restarts: 5 } })),
			[],
		);
	});

	it("fails one over the limit", () => {
		assert.equal(
			restartFailures(healthyFacts({ backend: { restarts: 6 } })).length,
			1,
		);
	});

	it("takes the limit from its caller", () => {
		assert.deepEqual(
			restartFailures(healthyFacts({ backend: { restarts: 6 } }), "10"),
			[],
		);
	});
});

describe("dev_sqlite_stale_services", () => {
	const startedEpoch = Math.floor(Date.parse(STARTED) / 1000);

	it("reports nothing when the stack started after the commit", () => {
		assert.equal(staleServices(healthyFacts(), startedEpoch - 60), "");
	});

	// backend and imap-worker serving a module graph 106 commits old: tsx loads
	// once, so the container start time is the code's age.
	it("names services that started before the commit", () => {
		assert.equal(
			staleServices(healthyFacts(), startedEpoch + 60),
			COMPOSE_SERVICES.filter((service) => service !== "migrate").join(" "),
		);
	});

	it("ignores the one-shot migrator", () => {
		assert.ok(
			!staleServices(healthyFacts(), startedEpoch + 60).includes("migrate"),
		);
	});

	it("ignores a service that is not running", () => {
		const facts = healthyFacts({ web: { status: "exited" } });
		assert.ok(!staleServices(facts, startedEpoch + 60).includes("web"));
	});
});

describe("the TLS probe", () => {
	let workDir;
	let tlsServer;
	let failingServer;
	let tcpServer;
	let tlsPort;
	let failingPort;
	let tcpPort;

	// Awaited, never spawnSync: the servers being probed live in this process, so
	// a synchronous child would block the loop that has to accept the connection.
	const runProbe = async (port) => {
		const options = {
			encoding: "utf8",
			env: {
				...process.env,
				REMIT_DEV_TLS_PORT: String(port),
				REMIT_DEV_TLS_TIMEOUT_MS: "3000",
			},
		};
		return execFileAsync(process.execPath, [PROBE], options)
			.then(({ stdout, stderr }) => ({ status: 0, stdout, stderr }))
			.catch((error) => ({
				status: error.code,
				stdout: error.stdout,
				stderr: error.stderr,
			}));
	};

	const listen = (server) =>
		new Promise((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve(server.address().port));
		});

	before(async () => {
		mkdirSync(TMP_ROOT, { recursive: true });
		workDir = mkdtempSync(join(TMP_ROOT, "dev-sqlite-tls-"));
		// The front-end this probes serves a certificate no store trusts, so the
		// suite has to hand it one of the same kind rather than a trusted fixture.
		execFileSync("openssl", [
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-subj",
			"/CN=localhost",
			"-keyout",
			join(workDir, "key.pem"),
			"-out",
			join(workDir, "cert.pem"),
		]);
		const credentials = {
			key: readFileSync(join(workDir, "key.pem")),
			cert: readFileSync(join(workDir, "cert.pem")),
		};

		tlsServer = createTlsServer(credentials, (_request, response) => {
			response.writeHead(200);
			response.end("ok");
		});
		tlsPort = await listen(tlsServer);

		failingServer = createTlsServer(credentials, (_request, response) => {
			response.writeHead(500);
			response.end("no");
		});
		failingPort = await listen(failingServer);

		tcpServer = createTcpServer((socket) => socket.end());
		tcpPort = await listen(tcpServer);
	});

	after(() => {
		tlsServer?.close();
		failingServer?.close();
		tcpServer?.close();
		if (workDir) rmSync(workDir, { recursive: true, force: true });
	});

	it("passes when the port answers over TLS", async () => {
		const result = await runProbe(tlsPort);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /answered over TLS with 200/);
	});

	// The state at discovery: nothing listening on 4143 at all.
	it("fails when nothing is listening", async () => {
		const idle = createTcpServer();
		const port = await listen(idle);
		await new Promise((resolve) => idle.close(resolve));

		const result = await runProbe(port);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /did not answer over TLS/);
	});

	it("fails when the port answers but not over TLS", async () => {
		const result = await runProbe(tcpPort);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /did not answer over TLS/);
	});

	// A front-end that handshakes and then reports its upstream is down is not a
	// working stack, which is what a listening TLS front over a 500 vite is.
	it("fails when the front answers 5xx", async () => {
		const result = await runProbe(failingPort);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /answered over TLS with 500/);
	});
});
