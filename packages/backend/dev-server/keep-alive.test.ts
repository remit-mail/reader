/**
 * The backend outlasts APISIX's idle upstream connection.
 *
 * APISIX reuses an idle connection to the backend for up to its keepalive
 * idle timeout. A backend that closes that socket first races the next request
 * onto a dead connection: GETs are retried, the web client's sync POST came
 * back as a 502. Caddy sits one hop further out and races the same way, so
 * every Caddy upstream that reaches the backend lets go of an idle connection
 * before the backend does.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Agent, request, type Server } from "node:http";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS } from "@remit/apisix/route-table";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../src/service/data-client.js";

const NODE_DEFAULT_KEEP_ALIVE_MS = 5_000;

const CADDY_ROUTES = resolve(
	import.meta.dirname,
	"../../../deploy/vps/caddy/routes.caddy",
);
const BACKEND_UPSTREAMS = new Set(["backend:8080", "apisix:9080"]);

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

let server: Server;
let port: number;

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
});

after(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	_resetForTest();
});

const get = (agent: Agent): Promise<{ status: number; reused: boolean }> =>
	new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path: "/accounts/oauth/microsoft/callback?error=access_denied",
				agent,
			},
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

describe("the backend's keep-alive against the APISIX upstream pool", () => {
	it("keeps an idle socket open longer than APISIX does", () => {
		assert.ok(
			server.keepAliveTimeout > UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS * 1_000,
			`backend keepAliveTimeout ${server.keepAliveTimeout}ms must exceed APISIX idle_timeout ${UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS}s`,
		);
		assert.ok(server.headersTimeout > server.keepAliveTimeout);
	});

	it("has every Caddy hop to the backend drop an idle socket before the backend does", () => {
		const proxies = findAll(
			parseCaddyfile(readFileSync(CADDY_ROUTES, "utf-8")),
			"reverse_proxy",
		).filter((proxy) =>
			proxy.args.slice(1).some((upstream) => BACKEND_UPSTREAMS.has(upstream)),
		);
		assert.ok(
			proxies.length > 0,
			"routes.caddy proxies nothing to the backend",
		);

		for (const proxy of proxies) {
			const keepalive = keepaliveMs(proxy);
			const upstream = proxy.args.slice(1).join(" ");
			assert.ok(
				keepalive !== undefined,
				`reverse_proxy ${upstream} relies on Caddy's 2m keepalive default`,
			);
			assert.ok(
				keepalive < server.keepAliveTimeout,
				`reverse_proxy ${upstream} keepalive ${keepalive}ms must be below the backend's ${server.keepAliveTimeout}ms`,
			);
		}
	});

	it("serves a request on a connection left idle past Node's default", async () => {
		const agent = new Agent({ keepAlive: true, maxSockets: 1 });

		const first = await get(agent);
		assert.equal(first.status, 302);

		await sleep(NODE_DEFAULT_KEEP_ALIVE_MS + 1_000);

		const second = await get(agent);
		agent.destroy();
		assert.equal(second.status, 302);
		assert.equal(second.reused, true);
	});
});
