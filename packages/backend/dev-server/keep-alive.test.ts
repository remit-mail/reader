/**
 * The backend outlasts APISIX's idle upstream connection.
 *
 * APISIX reuses an idle connection to the backend for up to its keepalive
 * idle timeout. A backend that closes that socket first races the next request
 * onto a dead connection: GETs are retried, the web client's sync POST came
 * back as a 502.
 */

import assert from "node:assert/strict";
import { Agent, request, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { UPSTREAM_KEEPALIVE_IDLE_TIMEOUT_SECONDS } from "@remit/apisix/route-table";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../src/service/data-client.js";

const NODE_DEFAULT_KEEP_ALIVE_MS = 5_000;

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
