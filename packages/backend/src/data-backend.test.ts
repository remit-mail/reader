import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { usesBetterAuthJwt } from "./data-backend.js";

describe("usesBetterAuthJwt", () => {
	const ORIGINAL = process.env.DATA_BACKEND;
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL;
	});

	it("is true for the self-host SQL backends", () => {
		process.env.DATA_BACKEND = "postgres";
		assert.equal(usesBetterAuthJwt(), true);
		process.env.DATA_BACKEND = "sqlite";
		assert.equal(usesBetterAuthJwt(), true);
	});

	it("is false for the AWS DynamoDB path and when unset", () => {
		process.env.DATA_BACKEND = "dynamodb";
		assert.equal(usesBetterAuthJwt(), false);
		delete process.env.DATA_BACKEND;
		assert.equal(usesBetterAuthJwt(), false);
	});
});
