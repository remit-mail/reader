// The MCP connector's route (caddy/mcp.caddy, remit-mail/remit#1342): the
// committed site files in the deployment's own Caddy, in front of stand-in
// upstreams that echo what they were handed. The connector's host reaches
// `mcp` and nothing else does, on a different domain from the instance; the
// client address is the edge's, never the client's; the auth headers cross in
// both directions.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");
const CADDY_DIR = join(DEPLOY, "caddy");
const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const containerRuntime = () => {
	for (const candidate of ["docker", "podman"]) {
		if (spawnSync(candidate, ["info"], { stdio: "ignore" }).status === 0) {
			return candidate;
		}
	}
	return null;
};
const CR = containerRuntime();
if (!CR && process.env.CI) {
	throw new Error(
		"no container runtime found (docker or podman) — this suite needs it",
	);
}
if (!CR) console.log("skipping: no container runtime found (docker or podman)");

const IMAGE = readFileSync(
	join(DEPLOY, "docker-compose.sqlite.yml"),
	"utf8",
).match(/^ {4}image: (caddy:\S+)$/m)?.[1];

const MAIN_HOST = "mail.remit.test";
const MCP_HOST = "mcp.other-domain.test";
// Documentation addresses (RFC 5737), so a leak cannot match a real peer.
const FORGED = "203.0.113.9";
const EDGE_CLIENT = "198.51.100.77";
const BEARER = "Bearer an-mcp-access-token";
const CHALLENGE =
	'Bearer resource_metadata="https://mcp.other-domain.test/.well-known/oauth-protected-resource/mcp"';

const isPrivate = (address) =>
	/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);

const MCP_ECHO = `:8080 {
	header WWW-Authenticate "${CHALLENGE.replaceAll('"', '\\"')}"
	respond "mcp|{http.request.header.X-Remit-Client-IP}|{http.request.header.Authorization}" 401
}
`;
const APP_ECHO = `:9080, :8080 {
	respond "app" 200
}
`;

const get = (origin, path, headers) =>
	new Promise((resolve, reject) => {
		const req = request(`${origin}${path}`, { headers }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				body += chunk;
			});
			res.on("end", () =>
				resolve({ status: res.statusCode, headers: res.headers, body }),
			);
		});
		req.on("error", reject);
		req.end();
	});

if (CR) {
	const run = (...args) => execFileSync(CR, args, { encoding: "utf8" }).trim();
	const stamp = `remit-mcp-route-${process.pid}`;
	const network = `${stamp}-net`;
	const started = [];
	let workdir = "";

	const edge = async (name, mode, mcpOrigin) => {
		const container = `${stamp}-${name}`;
		run(
			"run",
			"-d",
			"--name",
			container,
			"--network",
			network,
			"-p",
			"127.0.0.1::80",
			"-e",
			`PUBLIC_ORIGIN=https://${MAIN_HOST}`,
			"-e",
			`MCP_PUBLIC_ORIGIN=${mcpOrigin}`,
			"-v",
			`${join(CADDY_DIR, "routes.caddy")}:/etc/caddy/routes.caddy:ro`,
			"-v",
			`${join(CADDY_DIR, "mcp.caddy")}:/etc/caddy/mcp.caddy:ro`,
			"-v",
			`${join(CADDY_DIR, `${mode}.caddy`)}:/etc/caddy/Caddyfile:ro`,
			IMAGE,
		);
		started.push(container);
		const origin = `http://${run("port", container, "80/tcp").split("\n")[0].trim()}`;
		for (let attempt = 0; attempt < 80; attempt += 1) {
			const answered = await get(origin, "/", { host: MAIN_HOST }).catch(
				() => null,
			);
			if (answered) return origin;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`${container} never answered:\n${run("logs", container)}`);
	};

	const edges = {};

	before(async () => {
		workdir = mkdtempSync(join(TMP_ROOT, "mcp-route-"));
		writeFileSync(join(workdir, "mcp.caddy"), MCP_ECHO);
		writeFileSync(join(workdir, "app.caddy"), APP_ECHO);
		run("network", "create", network);
		for (const [name, aliases] of [
			["mcp", ["mcp"]],
			["app", ["apisix", "backend", "web"]],
		]) {
			const container = `${stamp}-${name}`;
			run(
				"run",
				"-d",
				"--name",
				container,
				"--network",
				network,
				...aliases.flatMap((alias) => ["--network-alias", alias]),
				"-v",
				`${join(workdir, `${name}.caddy`)}:/etc/caddy/Caddyfile:ro`,
				IMAGE,
			);
			started.push(container);
		}
		edges.off = await edge("off", "off", `http://${MCP_HOST}`);
		edges.unset = await edge("unset", "off", "http://mcp.invalid");
		edges.tunnel = await edge("tunnel", "tunnel", `https://${MCP_HOST}`);
	});

	after(() => {
		for (const name of started)
			spawnSync(CR, ["rm", "-f", name], { stdio: "ignore" });
		spawnSync(CR, ["network", "rm", network], { stdio: "ignore" });
		if (workdir) rmSync(workdir, { recursive: true, force: true });
	});

	describe("the MCP host behind off.caddy", () => {
		it("reaches the connector, on a domain that is not the instance's", async () => {
			const answer = await get(edges.off, "/mcp", { host: MCP_HOST });
			assert.match(answer.body, /^mcp\|/);
		});

		it("leaves the instance's own host on the app", async () => {
			const answer = await get(edges.off, "/mcp", { host: MAIN_HOST });
			assert.equal(answer.body, "app");
		});

		it("passes Authorization to the connector unchanged", async () => {
			const answer = await get(edges.off, "/mcp", {
				host: MCP_HOST,
				authorization: BEARER,
			});
			assert.equal(answer.body.split("|")[2], BEARER);
		});

		it("passes the connector's WWW-Authenticate back to the client", async () => {
			const answer = await get(edges.off, "/mcp", { host: MCP_HOST });
			assert.equal(answer.status, 401);
			assert.equal(answer.headers["www-authenticate"], CHALLENGE);
		});

		it("replaces a client-supplied X-Remit-Client-IP with the real peer", async () => {
			const answer = await get(edges.off, "/mcp", {
				host: MCP_HOST,
				"x-remit-client-ip": FORGED,
				"x-forwarded-for": FORGED,
			});
			const seen = answer.body.split("|")[1];
			assert.notEqual(seen, FORGED);
			assert.ok(
				isPrivate(seen),
				`expected the connection's own address, saw "${seen}"`,
			);
		});
	});

	describe("the MCP host with the connector off", () => {
		it("is not routed to the connector", async () => {
			const answer = await get(edges.unset, "/mcp", { host: MCP_HOST });
			assert.equal(answer.body, "app");
		});
	});

	describe("the MCP host behind tunnel.caddy", () => {
		it("matches the https origin on the plain-HTTP hop from the agent", async () => {
			const answer = await get(edges.tunnel, "/mcp", { host: MCP_HOST });
			assert.match(answer.body, /^mcp\|/);
		});

		it("states the address the edge stated, not the client's", async () => {
			const answer = await get(edges.tunnel, "/mcp", {
				host: MCP_HOST,
				"cf-connecting-ip": EDGE_CLIENT,
				"x-remit-client-ip": FORGED,
			});
			assert.equal(answer.body.split("|")[1], EDGE_CLIENT);
		});
	});

	describe("the MCP site in the certificate modes", () => {
		for (const mode of ["acme", "internal", "tailscale"]) {
			it(`${mode}.caddy gives the MCP host a site of its own, streamed unbuffered`, () => {
				const adapted = run(
					"run",
					"--rm",
					"-e",
					`PUBLIC_ORIGIN=https://${MAIN_HOST}`,
					"-e",
					`MCP_PUBLIC_ORIGIN=https://${MCP_HOST}`,
					"-v",
					`${CADDY_DIR}:/etc/caddy:ro`,
					IMAGE,
					"caddy",
					"adapt",
					"--config",
					`/etc/caddy/${mode}.caddy`,
					"--adapter",
					"caddyfile",
				);
				const config = JSON.parse(adapted);
				const routes = Object.values(config.apps.http.servers).flatMap(
					(server) => server.routes,
				);
				const mcp = routes.find((route) =>
					route.match?.some((match) => match.host?.includes(MCP_HOST)),
				);
				assert.ok(mcp, `${mode}.caddy has no route for ${MCP_HOST}`);
				assert.match(JSON.stringify(mcp), /"flush_interval":-1/);
				assert.match(JSON.stringify(mcp), /"dial":"mcp:8080"/);
			});
		}
	});
}
