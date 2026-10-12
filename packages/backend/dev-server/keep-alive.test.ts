/**
 * Every proxy hop lets go of an idle connection before its upstream does.
 *
 * A proxy that reuses a socket the upstream has just closed sends the next
 * request onto a dead connection: APISIX retries a GET, but the web client's
 * sync POST came back as a 502, and Caddy retries nothing. So APISIX's pool
 * idles out before the backend, and each Caddy upstream idles out before the
 * server behind it — measured against the running server where one runs here,
 * and against the shipped config where it does not.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Agent, request, type Server } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS } from "@remit/apisix/route-table";
import { parse as parseYaml } from "yaml";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../src/service/data-client.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CADDY_ROUTES = resolve(REPO_ROOT, "deploy/vps/caddy/routes.caddy");
const APISIX_CONFIG = resolve(REPO_ROOT, "packages/apisix/config.yaml");
const WEB_SERVER = resolve(REPO_ROOT, "docker/runtime/web/server.mjs");

const BACKEND = "backend:8080";
const APISIX = "apisix:9080";
const WEB = "web:8080";

interface Directive {
	args: string[];
	block: Directive[];
}

const parseCaddyfile = (source: string): Directive[] => {
	const root: Directive[] = [];
	const stack: Directive[][] = [root];
	for (const line of source.split("\n")) {
		const tokens: string[] = [];
		for (const token of line.trim().split(/\s+/)) {
			if (token.startsWith("#")) break;
			if (token !== "") tokens.push(token);
		}
		if (tokens.length === 0) continue;
		const current = stack[stack.length - 1] as Directive[];
		if (tokens.length === 1 && tokens[0] === "}") {
			stack.pop();
			continue;
		}
		const opens = tokens[tokens.length - 1] === "{";
		const directive: Directive = {
			args: opens ? tokens.slice(0, -1) : tokens,
			block: [],
		};
		current.push(directive);
		if (opens) stack.push(directive.block);
	}
	assert.equal(stack.length, 1, "unbalanced braces in routes.caddy");
	return root;
};

const findAll = (directives: Directive[], name: string): Directive[] =>
	directives.flatMap((directive) => [
		...(directive.args[0] === name ? [directive] : []),
		...findAll(directive.block, name),
	]);

const DURATION_UNITS_MS: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
};

const durationMs = (value: string): number => {
	const unit = Object.keys(DURATION_UNITS_MS)
		.filter((suffix) => value.endsWith(suffix))
		.sort((a, b) => b.length - a.length)[0];
	assert.ok(unit, `${value} is not a Caddy duration`);
	const amount = Number(value.slice(0, -unit.length));
	assert.ok(Number.isFinite(amount), `${value} is not a Caddy duration`);
	return amount * (DURATION_UNITS_MS[unit] as number);
};

const caddyProxies = (): Directive[] =>
	findAll(parseCaddyfile(readFileSync(CADDY_ROUTES, "utf-8")), "reverse_proxy");

const upstreamsOf = (proxy: Directive): string[] => proxy.args.slice(1);

const keepaliveMs = (proxy: Directive): number | undefined => {
	const transport = proxy.block.find(
		(directive) =>
			directive.args[0] === "transport" && directive.args[1] === "http",
	);
	const keepalive = transport?.block.find(
		(directive) => directive.args[0] === "keepalive",
	);
	return keepalive?.args[1] === undefined
		? undefined
		: durationMs(keepalive.args[1]);
};

const longestCaddyKeepaliveTo = (upstream: string): number => {
	const keepalives = caddyProxies()
		.filter((proxy) => upstreamsOf(proxy).includes(upstream))
		.map((proxy) => keepaliveMs(proxy) ?? Number.POSITIVE_INFINITY);
	assert.ok(
		keepalives.length > 0,
		`routes.caddy proxies nothing to ${upstream}`,
	);
	return Math.max(...keepalives);
};

const apisixClientKeepaliveMs = (): number => {
	const config: unknown = parseYaml(readFileSync(APISIX_CONFIG, "utf-8"));
	const timeout =
		typeof config === "object" &&
		config !== null &&
		"nginx_config" in config &&
		typeof config.nginx_config === "object" &&
		config.nginx_config !== null &&
		"http" in config.nginx_config &&
		typeof config.nginx_config.http === "object" &&
		config.nginx_config.http !== null &&
		"keepalive_timeout" in config.nginx_config.http
			? config.nginx_config.http.keepalive_timeout
			: undefined;
	assert.equal(
		typeof timeout,
		"string",
		"apisix config.yaml states no nginx_config.http.keepalive_timeout",
	);
	return durationMs(timeout as string);
};

const freePort = (): Promise<number> =>
	new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const free = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolvePort(free));
		});
	});

let server: Server;
let port: number;
let web: ChildProcess | undefined;
let webPort: number;

before(async () => {
	setClient({} as unknown as RemitClient);

	process.env.BETTER_AUTH_SECRET = "a-signing-secret-of-at-least-32-characters";
	process.env.CORS_ALLOWED_ORIGINS = "https://mail.example.com";
	process.env.SERVER_PORT = "0";

	const imported = await import("./server.js");
	server = imported.listener;
	if (!server.listening) {
		await new Promise<void>((resolve) => server.once("listening", resolve));
	}
	const address = server.address();
	port = typeof address === "object" && address ? address.port : 0;

	webPort = await freePort();
	const child = spawn(process.execPath, [WEB_SERVER], {
		env: {
			...process.env,
			WEB_DIST_DIR: import.meta.dirname,
			PORT: String(webPort),
		},
		stdio: ["ignore", "pipe", "inherit"],
	});
	web = child;
	await new Promise<void>((resolve, reject) => {
		child.on("exit", (code) =>
			reject(new Error(`the web server exited with ${code} before listening`)),
		);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (line: string) => {
			if (line.includes("serving")) resolve();
		});
	});
});

after(async () => {
	web?.kill();
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	_resetForTest();
});

const get = (
	agent: Agent,
	target: { port: number; path: string },
): Promise<{ status: number; reused: boolean }> =>
	new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port: target.port, path: target.path, agent },
			(response) => {
				response.resume();
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						reused: req.reusedSocket,
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});

const survivesIdle = async (
	target: { port: number; path: string },
	idleMs: number,
): Promise<boolean> => {
	const agent = new Agent({ keepAlive: true, maxSockets: 1 });
	await get(agent, target);
	await sleep(idleMs);
	const second = await get(agent, target);
	agent.destroy();
	return second.reused;
};

describe("idle keep-alive sockets across the proxy hops", () => {
	it("has every Caddy upstream state its keepalive and name a known server", () => {
		const known = new Set([BACKEND, APISIX, WEB]);
		const proxies = caddyProxies();
		assert.ok(proxies.length > 0);
		for (const proxy of proxies) {
			const upstream = upstreamsOf(proxy).join(" ");
			assert.ok(
				upstreamsOf(proxy).every((name) => known.has(name)),
				`reverse_proxy ${upstream} has no idle timeout pinned here`,
			);
			assert.ok(
				keepaliveMs(proxy) !== undefined,
				`reverse_proxy ${upstream} relies on Caddy's 2m keepalive default`,
			);
		}
	});

	it("keeps the backend's idle socket open longer than APISIX and Caddy hold it", () => {
		assert.ok(
			server.keepAliveTimeout > UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS * 1_000,
			`backend keepAliveTimeout ${server.keepAliveTimeout}ms must exceed APISIX idle_timeout ${UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS}s`,
		);
		assert.ok(server.keepAliveTimeout > longestCaddyKeepaliveTo(BACKEND));
		assert.ok(server.headersTimeout > server.keepAliveTimeout);
	});

	it("has Caddy drop an idle APISIX socket before APISIX does", () => {
		assert.ok(longestCaddyKeepaliveTo(APISIX) < apisixClientKeepaliveMs());
	});

	it("serves the backend on a socket left idle as long as Caddy holds it", async () => {
		assert.equal(
			await survivesIdle(
				{
					port,
					path: "/accounts/oauth/microsoft/callback?error=access_denied",
				},
				longestCaddyKeepaliveTo(BACKEND) + 1_000,
			),
			true,
		);
	});

	it("serves the web client on a socket left idle as long as Caddy holds it", async () => {
		assert.equal(
			await survivesIdle(
				{ port: webPort, path: "/health" },
				longestCaddyKeepaliveTo(WEB) + 1_000,
			),
			true,
		);
	});
});
