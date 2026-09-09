/**
 * The OAuth callback through the dev-server's own app — the process a
 * self-host container runs.
 *
 * One hop further than the handler test: the app object imported from
 * `server.ts`, so what is asserted is the header express actually writes onto
 * the socket for Microsoft's returning browser. The handler answering 302 is
 * not the same claim as the browser being sent anywhere, and the difference
 * between the two was a blank page.
 *
 * The identity tier is left unmounted — this app serves the route either way,
 * and the callback's exemption from the session gate is pinned where that gate
 * runs, in `src/handlers/account-oauth-callback.test.ts`.
 */

import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../src/service/data-client.js";

const WEB_ORIGIN = "https://mail.example.com";

let server: Server;
let port: number;

before(async () => {
	// Microsoft's redirect carries no session, so the callback answers before it
	// reads anything: no store is touched on this path.
	setClient({} as unknown as RemitClient);

	process.env.BETTER_AUTH_SECRET = "a-signing-secret-of-at-least-32-characters";
	process.env.CORS_ALLOWED_ORIGINS = WEB_ORIGIN;
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
	await new Promise<void>((resolve) => server.close(() => resolve()));
	_resetForTest();
});

describe("GET /accounts/oauth/microsoft/callback through the dev-server's own app", () => {
	it("answers the browser with somewhere to go", async () => {
		const response = await fetch(
			`http://127.0.0.1:${port}/accounts/oauth/microsoft/callback?error=access_denied`,
			{ redirect: "manual" },
		);

		assert.equal(response.status, 302);
		assert.equal(
			response.headers.get("location"),
			`${WEB_ORIGIN}/settings/accounts?oauthError=access_denied`,
		);
	});
});
