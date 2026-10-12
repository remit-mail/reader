import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Server } from "node:http";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS } from "./route-table.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CADDY_ROUTES = resolve(REPO_ROOT, "deploy/vps/caddy/routes.caddy");
const APISIX_CONFIG = resolve(REPO_ROOT, "packages/apisix/config.yaml");
const WEB_SERVER = resolve(REPO_ROOT, "docker/runtime/web/server.mjs");

const DURATION_UNITS_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

const durationMs = (value: string): number => {
	const match = /^(\d+)(ms|s|m|h)$/.exec(value);
	assert.ok(match, `${value} is not a duration`);
	const [, amount, unit] = match;
	return (
		Number(amount) * DURATION_UNITS_MS[unit as keyof typeof DURATION_UNITS_MS]
	);
};

const apisixConfig = z.object({
	nginx_config: z.object({
		http: z.object({ keepalive_timeout: z.string() }),
	}),
});

const webModule = z.object({ server: z.instanceof(Server) });

const caddyLines = readFileSync(CADDY_ROUTES, "utf-8")
	.split("\n")
	.map((line) => line.trim());

const caddyKeepaliveMs = (): number => {
	const keepalives = caddyLines.filter((line) => line.startsWith("keepalive "));
	assert.equal(
		keepalives.length,
		1,
		"routes.caddy sets keepalive outside the upstream snippet",
	);
	return durationMs((keepalives[0] as string).split(/\s+/)[1] as string);
};

let web: Server;

before(async () => {
	process.env.PORT = "0";
	process.env.WEB_DIST_DIR = import.meta.dirname;
	const specifier: string = WEB_SERVER;
	web = webModule.parse(await import(specifier)).server;
});

after(async () => {
	await new Promise<void>((resolve) => web.close(() => resolve()));
});

describe("Caddy lets go of an idle upstream socket before the server behind it", () => {
	it("routes every reverse_proxy through the upstream snippet", () => {
		const proxies = caddyLines
			.map((line, index) => ({ line, next: caddyLines[index + 1] }))
			.filter(({ line }) => line.startsWith("reverse_proxy "));
		assert.ok(proxies.length > 0, "routes.caddy proxies nothing");
		for (const { line, next } of proxies) {
			assert.equal(
				next,
				"import upstream",
				`${line} skips the upstream snippet`,
			);
		}
	});

	it("idles out before APISIX closes the client connection", () => {
		const { nginx_config } = apisixConfig.parse(
			parseYaml(readFileSync(APISIX_CONFIG, "utf-8")),
		);
		assert.ok(
			caddyKeepaliveMs() < durationMs(nginx_config.http.keepalive_timeout),
		);
	});

	it("idles out before the backend, which outlasts the APISIX upstream pool", () => {
		assert.ok(
			caddyKeepaliveMs() < UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS * 1_000,
		);
	});

	it("idles out before the web server", () => {
		assert.ok(caddyKeepaliveMs() < web.keepAliveTimeout);
	});
});
