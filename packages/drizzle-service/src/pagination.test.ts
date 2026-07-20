import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeToken, encodeToken, resultList } from "./pagination.js";

describe("continuation token decoding", () => {
	test("round-trips a minted token", () => {
		const token = encodeToken({ createdAt: 42, accountId: "a-1" });
		assert.deepEqual(decodeToken(token), { createdAt: 42, accountId: "a-1" });
	});

	test("decodes a standard base64 token when asked", () => {
		const token = Buffer.from(JSON.stringify({ id: "x" })).toString("base64");
		assert.deepEqual(decodeToken(token, "base64"), { id: "x" });
	});

	for (const [label, token] of [
		["unparseable", "not-a-cursor"],
		["a bare number", Buffer.from("123").toString("base64url")],
		["a JSON array", Buffer.from("[1,2]").toString("base64url")],
		["JSON null", Buffer.from("null").toString("base64url")],
	] as const) {
		test(`rejects ${label}`, () => {
			assert.throws(
				() => decodeToken(token),
				(error: unknown) => {
					assert.equal((error as { statusCode?: number }).statusCode, 400);
					assert.equal((error as Error).name, "BadRequestError");
					return true;
				},
			);
		});
	}

	test("a full page yields a token and a short page does not", () => {
		assert.ok(resultList([1, 2], 2, { createdAt: 1 }).continuationToken);
		assert.equal(
			resultList([1], 2, { createdAt: 1 }).continuationToken,
			undefined,
		);
	});
});
