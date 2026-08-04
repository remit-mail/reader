// The tunnel serving path (reader#567 D1-D4, D6, D7, D9, D11).
//
// Three layers, none of which reads the two files' text and agrees with a typo:
// what an operator's `.env` resolves to, what Caddy makes of the site file, and
// what an upstream actually receives from a proxied request.
//
// The last one is the point. Everything behind Caddy learns the client address
// from X-Remit-Client-IP, which routes.caddy sets from `{client_ip}` — and in
// this mode `{client_ip}` is the tunnel agent's own container address unless the
// global options block in tunnel.caddy is exactly right. Wrong, and every client
// on the internet shares one sign-in rate-limit bucket on a publicly reachable
// origin, which is a lockout a stranger can trigger.
//
// The compose trap is invisible in the source: compose interpolates the whole
// document before it filters by profile, so a `${VAR:?}` guard on a profiled
// service fails every command on every deployment that never turned the profile
// on. `an existing deployment's .env` is what catches that coming back.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");
const COMPOSE = join(DEPLOY, "docker-compose.sqlite.yml");
const CADDY_DIR = join(DEPLOY, "caddy");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// A missing tool is a fact about a developer's machine and never about CI:
// skipping there would leave a suite that reports green without having resolved
// or proxied anything.
const require_ = (available, what) => {
	if (available) return true;
	if (process.env.CI) throw new Error(`${what} — this suite needs it`);
	console.log(`skipping: ${what}`);
	return false;
};

const COMPOSE_OK = require_(
	spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0,
	"no `docker compose` on this machine",
);

const containerRuntime = () => {
	for (const candidate of ["docker", "podman"]) {
		if (spawnSync(candidate, ["info"], { stdio: "ignore" }).status === 0) {
			return candidate;
		}
	}
	return null;
};
const CR = containerRuntime();
require_(CR, "no container runtime found (docker or podman)");

// A controlled environment: compose reads the process environment as well as
// --env-file, and the ambient one would decide the answer on some machines and
// not others.
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

// The variables an existing deployment already has. Every value this suite is
// about is absent from it on purpose — that is what "no .env change" means.
const EXISTING_ENV = [
	"REMIT_TAG=v1.0.0",
	"PUBLIC_ORIGIN=https://mail.example.test",
	"REMIT_DEPLOY_DIR=/opt/reader",
];

function composeConfig(lines, args = ["--format", "json"]) {
	const dir = mkdtempSync(join(TMP_ROOT, "tls-mode-tunnel-"));
	sandboxes.push(dir);
	copyFileSync(COMPOSE, join(dir, "docker-compose.sqlite.yml"));
	writeFileSync(join(dir, ".env"), `${lines.join("\n")}\n`);
	return spawnSync(
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
}

function resolved(lines) {
	const run = composeConfig(lines);
	assert.equal(
		run.status,
		0,
		`docker compose config failed: ${run.stderr || run.stdout}`,
	);
	return JSON.parse(run.stdout);
}

function services(lines) {
	const run = composeConfig(lines, ["--services"]);
	assert.equal(
		run.status,
		0,
		`docker compose config --services failed: ${run.stderr || run.stdout}`,
	);
	return run.stdout.split("\n").filter(Boolean).sort();
}

const publish = (config) =>
	config.services.caddy.ports.map(
		({ host_ip, published, target }) => `${host_ip}:${published}->${target}`,
	);

describe("an existing deployment's .env", { skip: !COMPOSE_OK }, () => {
	it("still resolves, with none of this mode's variables set", () => {
		const run = composeConfig(EXISTING_ENV);
		assert.equal(
			run.status,
			0,
			`a deployment that never heard of a tunnel must resolve unchanged: ${run.stderr}`,
		);
	});

	it("publishes caddy on the two host ports it published before", () => {
		assert.deepEqual(publish(resolved(EXISTING_ENV)), [
			"0.0.0.0:80->80",
			"0.0.0.0:443->443",
		]);
	});

	it("starts no tunnel agent", () => {
		assert.ok(!services(EXISTING_ENV).includes("tunnel"));
	});

	it("still starts everything it started before", () => {
		const running = services(EXISTING_ENV);
		for (const service of ["caddy", "backend", "apisix", "web", "doctor"]) {
			assert.ok(running.includes(service), `${service} must stay always-on`);
		}
	});
});

const TUNNEL_ENV = [
	...EXISTING_ENV,
	"TLS_MODE=tunnel",
	"COMPOSE_PROFILES=tunnel",
	"TUNNEL_TOKEN=a-tunnel-credential",
	"CADDY_HTTP_BIND=127.0.0.1:8080",
	"CADDY_HTTPS_BIND=127.0.0.1:8443",
];

describe("TLS_MODE=tunnel", { skip: !COMPOSE_OK }, () => {
	it("serves the mode's own site file", () => {
		const sources = resolved(TUNNEL_ENV).services.caddy.volumes.map(
			(volume) => volume.source,
		);
		assert.ok(
			sources.some((source) => source.endsWith("/caddy/tunnel.caddy")),
			`expected caddy/tunnel.caddy mounted as the Caddyfile, got ${sources}`,
		);
	});

	it("brings the agent up when COMPOSE_PROFILES names it", () => {
		assert.ok(services(TUNNEL_ENV).includes("tunnel"));
	});

	it("leaves the agent down when only TLS_MODE says tunnel", () => {
		assert.ok(
			!services([...EXISTING_ENV, "TLS_MODE=tunnel"]).includes("tunnel"),
			"the profile is what starts the agent; remit doctor reports the disagreement",
		);
	});

	it("hands the credential to the agent as an environment variable", () => {
		assert.equal(
			resolved(TUNNEL_ENV).services.tunnel.environment.TUNNEL_TOKEN,
			"a-tunnel-credential",
		);
	});

	it("keeps the credential off the command line, out of inspect and ps", () => {
		const tunnel = resolved(TUNNEL_ENV).services.tunnel;
		const command = [tunnel.entrypoint ?? [], tunnel.command ?? []]
			.flat()
			.join(" ");
		assert.ok(
			!command.includes("a-tunnel-credential"),
			`the token must never reach the command line, got: ${command}`,
		);
		assert.ok(!command.includes("--token"));
	});

	it("publishes caddy only where the operator can reach it over SSH", () => {
		assert.deepEqual(publish(resolved(TUNNEL_ENV)), [
			"127.0.0.1:8080->80",
			"127.0.0.1:8443->443",
		]);
	});

	it("names Cloudflare's client-IP header unless the operator names another", () => {
		assert.equal(
			resolved(TUNNEL_ENV).services.caddy.environment.TUNNEL_CLIENT_IP_HEADER,
			"Cf-Connecting-Ip",
		);
		assert.equal(
			resolved([...TUNNEL_ENV, "TUNNEL_CLIENT_IP_HEADER=X-Edge-Client-Ip"])
				.services.caddy.environment.TUNNEL_CLIENT_IP_HEADER,
			"X-Edge-Client-Ip",
		);
	});
});

describe("the OAuth callback the browser returns to", {
	skip: !COMPOSE_OK,
}, () => {
	it("is the public origin's, in every service that holds app configuration", () => {
		const config = resolved(EXISTING_ENV);
		for (const service of ["backend", "imap-worker", "smtp-worker"]) {
			assert.equal(
				config.services[service].environment.MSOAUTH_REDIRECT_URI,
				"https://mail.example.test/api/accounts/oauth/microsoft/callback",
				`${service} must derive the callback from PUBLIC_ORIGIN`,
			);
		}
	});

	it("follows PUBLIC_ORIGIN, so moving a deployment is one .env edit", () => {
		assert.equal(
			resolved([
				"REMIT_TAG=v1.0.0",
				"PUBLIC_ORIGIN=https://beta.example.org",
				"REMIT_DEPLOY_DIR=/opt/reader",
			]).services.backend.environment.MSOAUTH_REDIRECT_URI,
			"https://beta.example.org/api/accounts/oauth/microsoft/callback",
		);
	});
});

// The same Caddy the deployment runs, adapting the committed site file: a
// directive that does not exist, or an option renamed in a later Caddy, fails
// here rather than at an operator's first request.
const IMAGE = readFileSync(COMPOSE, "utf8").match(
	/^ {4}image: (caddy:\S+)$/m,
)?.[1];

function adapt(header) {
	const run = spawnSync(
		CR ?? "docker",
		[
			"run",
			"--rm",
			"-e",
			`TUNNEL_CLIENT_IP_HEADER=${header}`,
			"-v",
			`${CADDY_DIR}:/etc/caddy:ro`,
			IMAGE,
			"caddy",
			"adapt",
			"--config",
			"/etc/caddy/tunnel.caddy",
			"--adapter",
			"caddyfile",
		],
		{ encoding: "utf8", env: CLEAN_ENV },
	);
	assert.equal(run.status, 0, `caddy adapt failed: ${run.stderr}`);
	const servers = Object.values(JSON.parse(run.stdout).apps.http.servers);
	assert.equal(servers.length, 1, "one deployment, one Caddy, one server");
	return servers[0];
}

describe("caddy/tunnel.caddy", { skip: !CR }, () => {
	it("is adapted by the Caddy the compose file runs", () => {
		assert.ok(IMAGE, "no caddy image found in the compose file");
	});

	it("binds a port and carries no hostname, because the certificate is at the edge", () => {
		assert.deepEqual(adapt("Cf-Connecting-Ip").listen, [":80"]);
	});

	it("reads the client IP only from the header the edge overwrites", () => {
		const server = adapt("Cf-Connecting-Ip");
		assert.deepEqual(server.client_ip_headers, ["Cf-Connecting-Ip"]);
		assert.ok(
			!server.client_ip_headers.includes("X-Forwarded-For"),
			"a header a browser sets must never be the source of the client address",
		);
	});

	it("reads it only from a connection that cannot come from the internet", () => {
		const server = adapt("Cf-Connecting-Ip");
		assert.equal(server.trusted_proxies.source, "static");
		assert.deepEqual(
			[...server.trusted_proxies.ranges].sort(),
			[
				"10.0.0.0/8",
				"127.0.0.1/8",
				"172.16.0.0/12",
				"192.168.0.0/16",
				"::1",
				"fd00::/8",
			],
			"only the private ranges, which is where the agent is and the internet is not",
		);
		assert.ok(
			server.trusted_proxies_strict,
			"without strict, an entry an untrusted hop added is still read",
		);
	});

	it("takes the header name from the operator's variable", () => {
		assert.deepEqual(adapt("X-Edge-Client-Ip").client_ip_headers, [
			"X-Edge-Client-Ip",
		]);
	});
});

// The behavioural half: the committed tunnel.caddy and routes.caddy, in the
// deployment's own Caddy image, in front of an upstream that answers with the
// header it was handed. Read out of a real proxied request, because the whole
// chain — trusted hop, named header, {client_ip}, X-Remit-Client-IP — only
// holds end to end.
if (CR) {
	// Documentation addresses (RFC 5737), so a leak into an assertion cannot
	// match a real peer.
	const FORGED = ["203.0.113.9", "203.0.113.44"];
	const EDGE_CLIENT = "198.51.100.77";
	const CLIENT_IP_HEADER = "Cf-Connecting-Ip";
	// What auth-service reads (packages/auth-service/src/auth.ts,
	// CLIENT_IP_HEADER) and what routes.caddy sets from {client_ip}.
	const HEADER = "X-Remit-Client-IP";

	const ECHO_CADDYFILE = [":9080", ":8080"]
		.map(
			(address) =>
				`${address} {\n\trespond "{http.request.header.${HEADER}}" 200\n}\n`,
		)
		.join("\n");

	// One per route the table declares, so a route that forgets the header is
	// not covered by a neighbour that does not.
	const PATHS = [
		"/health",
		"/api/auth/sign-in/email",
		"/api/accounts",
		"/content/anything",
		"/",
	];

	const run = (...args) => execFileSync(CR, args, { encoding: "utf8" }).trim();
	const isPrivate = (address) =>
		/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);

	describe("a request proxied through tunnel.caddy", () => {
		const stamp = `remit-tunnel-ip-${process.pid}`;
		const network = `${stamp}-net`;
		const echo = `${stamp}-echo`;
		const edge = `${stamp}-edge`;
		let workdir = "";
		let origin = "";

		before(async () => {
			workdir = mkdtempSync(join(TMP_ROOT, "tunnel-ip-"));
			writeFileSync(join(workdir, "echo.caddy"), ECHO_CADDYFILE);

			run("network", "create", network);
			// One image for both ends: the upstream is the same Caddy, answering
			// with the header it was handed, so this pulls nothing the deployment
			// does not already run. It answers to all three service names the
			// routing table dials, so every route in it lands here.
			run(
				"run",
				"-d",
				"--name",
				echo,
				"--network",
				network,
				"--network-alias",
				"apisix",
				"--network-alias",
				"backend",
				"--network-alias",
				"web",
				"-v",
				`${join(workdir, "echo.caddy")}:/etc/caddy/Caddyfile:ro`,
				IMAGE,
			);
			// Both files mounted where docker-compose.sqlite.yml mounts them, with
			// the variable the compose file supplies. Nothing is synthesized: this
			// is the deployment's configuration, served.
			run(
				"run",
				"-d",
				"--name",
				edge,
				"--network",
				network,
				"-e",
				`TUNNEL_CLIENT_IP_HEADER=${CLIENT_IP_HEADER}`,
				"-p",
				"127.0.0.1::80",
				"-v",
				`${join(CADDY_DIR, "routes.caddy")}:/etc/caddy/routes.caddy:ro`,
				"-v",
				`${join(CADDY_DIR, "tunnel.caddy")}:/etc/caddy/Caddyfile:ro`,
				IMAGE,
			);
			origin = `http://${run("port", edge, "80/tcp").split("\n")[0].trim()}`;

			for (let attempt = 0; attempt < 80; attempt += 1) {
				const answered = await fetch(`${origin}/health`).catch(() => null);
				if (answered) return;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			throw new Error(`the edge never answered:\n${run("logs", edge)}`);
		});

		after(() => {
			for (const name of [edge, echo]) {
				spawnSync(CR, ["rm", "-f", name], { stdio: "ignore" });
			}
			spawnSync(CR, ["network", "rm", network], { stdio: "ignore" });
			if (workdir) rmSync(workdir, { recursive: true, force: true });
		});

		const seenBy = async (path, headers) =>
			(await (await fetch(`${origin}${path}`, { headers })).text()).trim();

		for (const path of PATHS) {
			it(`states the address the edge stated, on ${path}`, async () => {
				const seen = await seenBy(path, {
					[CLIENT_IP_HEADER]: EDGE_CLIENT,
					"X-Forwarded-For": FORGED.join(", "),
				});
				assert.equal(
					seen,
					EDGE_CLIENT,
					`${path}: the upstream saw "${seen}", so the rate limit does not count this client`,
				);
			});
		}

		for (const path of PATHS) {
			it(`discards a forged X-Forwarded-For, on ${path}`, async () => {
				const seen = await seenBy(path, {
					"X-Forwarded-For": FORGED.join(", "),
					"X-Real-IP": FORGED[0],
				});
				for (const forged of FORGED) {
					assert.ok(
						!seen.includes(forged),
						`${path}: a client-supplied address reached the upstream as "${seen}"`,
					);
				}
				assert.ok(
					isPrivate(seen),
					`${path}: expected the address of the connection itself, saw "${seen}"`,
				);
			});
		}

		it("hands the upstream one address, never a chain", async () => {
			const seen = await seenBy("/api/auth/sign-in/email", {
				[CLIENT_IP_HEADER]: `${EDGE_CLIENT}, ${FORGED[0]}`,
			});
			assert.ok(seen.length > 0, "the upstream saw no client address");
			assert.ok(
				!seen.includes(","),
				`the upstream saw a chain it cannot attribute to one client: "${seen}"`,
			);
		});
	});
}
