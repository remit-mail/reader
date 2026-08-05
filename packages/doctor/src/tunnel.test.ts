import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeTunnel } from "./tunnel.js";

const READY_URL = "http://tunnel:2000/ready";

const answering = (status: number) =>
	(async () => new Response("", { status })) as unknown as typeof fetch;

const refusing = (message: string) =>
	(async () => {
		throw new Error(message);
	}) as unknown as typeof fetch;

describe("probeTunnel", () => {
	it("reads a connected agent off its 200", async () => {
		const reading = await probeTunnel(READY_URL, 1000, answering(200));
		assert.equal(reading.error, undefined);
	});

	it("reads a disconnected agent off anything else, and says the status", async () => {
		const reading = await probeTunnel(READY_URL, 1000, answering(503));
		assert.equal(reading.error, "HTTP 503");
	});

	it("turns a refused connection into a reading rather than a throw", async () => {
		const reading = await probeTunnel(
			READY_URL,
			1000,
			refusing("connect ECONNREFUSED 172.18.0.9:2000"),
		);
		assert.match(reading.error ?? "", /ECONNREFUSED/);
	});

	it("asks the URL it was given", async () => {
		const seen: string[] = [];
		const recording = (async (url: string) => {
			seen.push(url);
			return new Response("", { status: 200 });
		}) as unknown as typeof fetch;
		await probeTunnel("http://edge:9000/healthz", 1000, recording);
		assert.deepEqual(seen, ["http://edge:9000/healthz"]);
	});
});
