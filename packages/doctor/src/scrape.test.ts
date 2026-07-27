import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrapeAll, scrapeTarget } from "./scrape.js";

const ok = (body: string) =>
	(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

describe("scrapeTarget", () => {
	it("parses a 200 response", async () => {
		const result = await scrapeTarget(
			{ service: "queue", url: "http://queue:9324/metrics" },
			1000,
			ok('remit_queue_messages{queue="a",role="work"} 1\n'),
		);
		assert.equal(result.error, undefined);
		assert.equal(result.samples.length, 1);
	});

	it("reads a non-2xx as a failure, not as an empty set of signals", async () => {
		const result = await scrapeTarget(
			{ service: "backend", url: "http://backend:8080/metrics" },
			1000,
			(async () =>
				new Response("collection failed", {
					status: 500,
				})) as unknown as typeof fetch,
		);
		assert.equal(result.error, "HTTP 500");
		assert.deepEqual(result.samples, []);
	});

	it("reads a refused connection as a failure rather than throwing", async () => {
		const result = await scrapeTarget(
			{ service: "backend", url: "http://backend:8080/metrics" },
			1000,
			(async () => {
				throw new Error("connect ECONNREFUSED");
			}) as unknown as typeof fetch,
		);
		assert.match(result.error ?? "", /ECONNREFUSED/);
	});

	it("describes a thrown non-Error", async () => {
		const result = await scrapeTarget(
			{ service: "backend", url: "http://backend:8080/metrics" },
			1000,
			(async () => {
				throw "nope";
			}) as unknown as typeof fetch,
		);
		assert.equal(result.error, "nope");
	});
});

describe("scrapeAll", () => {
	it("one refused endpoint does not cost the readings of the others", async () => {
		const results = await scrapeAll(
			[
				{ service: "backend", url: "http://backend:8080/metrics" },
				{ service: "queue", url: "http://queue:9324/metrics" },
			],
			1000,
			(async (url: string) => {
				if (url.includes("backend")) throw new Error("down");
				return new Response("x 1\n", { status: 200 });
			}) as unknown as typeof fetch,
		);
		assert.equal(results[0].error, "down");
		assert.equal(results[1].samples.length, 1);
	});
});
