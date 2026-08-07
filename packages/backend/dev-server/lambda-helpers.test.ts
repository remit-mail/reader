import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { createLambdaEvent } from "./lambda-helpers.js";

const asRequest = (body: unknown): Request =>
	({
		method: "POST",
		path: "/outbox/draft1/attachments",
		params: {},
		query: {},
		headers: {},
		body,
		get: () => undefined,
	}) as unknown as Request;

describe("createLambdaEvent", () => {
	it("delivers a binary body base64-encoded, the way API Gateway does", () => {
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

		const event = createLambdaEvent(asRequest(bytes));

		assert.equal(event.isBase64Encoded, true);
		assert.deepEqual(Buffer.from(event.body ?? "", "base64"), bytes);
	});

	it("still delivers a parsed JSON body as a JSON string", () => {
		const event = createLambdaEvent(asRequest({ subject: "hello" }));

		assert.equal(event.isBase64Encoded, false);
		assert.equal(event.body, '{"subject":"hello"}');
	});

	it("delivers no body at all when there was none", () => {
		const event = createLambdaEvent(asRequest(undefined));

		assert.equal(event.isBase64Encoded, false);
		assert.equal(event.body, null);
	});
});
