import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pingDeadMan } from "./deadman.js";

describe("pingDeadMan", () => {
	it("GETs the configured url and sends nothing else", async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		await pingDeadMan("https://hc-ping.example/uuid", 1000, (async (
			url: string,
			init: RequestInit,
		) => {
			seen = { url, init };
			return new Response("OK", { status: 200 });
		}) as unknown as typeof fetch);
		assert.equal(seen?.url, "https://hc-ping.example/uuid");
		assert.equal(seen?.init.method, "GET");
		assert.equal(seen?.init.body, undefined);
	});

	it("reports a rejected ping", async () => {
		await assert.rejects(
			pingDeadMan(
				"https://hc-ping.example/uuid",
				1000,
				(async () =>
					new Response("", { status: 404 })) as unknown as typeof fetch,
			),
			/HTTP 404/,
		);
	});
});
