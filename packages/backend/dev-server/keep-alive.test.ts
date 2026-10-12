import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, it } from "node:test";
import { UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS } from "@remit/apisix/route-table";

let server: Server;

before(async () => {
	process.env.BETTER_AUTH_SECRET = "a-signing-secret-of-at-least-32-characters";
	process.env.CORS_ALLOWED_ORIGINS = "https://mail.example.com";
	process.env.SERVER_PORT = "0";
	server = (await import("./server.js")).listener;
});

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("keeps an idle socket open longer than the APISIX upstream pool does", () => {
	assert.ok(
		server.keepAliveTimeout > UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS * 1_000,
		`backend keepAliveTimeout ${server.keepAliveTimeout}ms must exceed APISIX idle_timeout ${UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS}s`,
	);
});
