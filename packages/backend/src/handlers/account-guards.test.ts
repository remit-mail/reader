import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountAuthType } from "@remit/domain-enums";
import type { APIGatewayProxyResult } from "aws-lambda";
import { handleError } from "../error.js";
import {
	assertNotOAuthCreate,
	assertPasswordProvided,
} from "./account-guards.js";

const refusalOf = (guard: () => void): Promise<APIGatewayProxyResult> => {
	let thrown: unknown;
	assert.throws(guard, (error: unknown) => {
		thrown = error;
		return true;
	});
	return handleError(thrown);
};

// Both guards used to throw `{ status: 400 }`, and the emitter reads
// `statusCode`. The status never matched, so a create the API meant to refuse
// as malformed answered 500 with "Internal server error" — telling the caller
// the server broke rather than what to change (issue #371).
describe("the create-account guards", () => {
	it("refuses an OAuth create as a 400 the caller can act on", async () => {
		const response = await refusalOf(() =>
			assertNotOAuthCreate(AccountAuthType.OauthMicrosoft),
		);

		assert.equal(response.statusCode, 400);
		const body = JSON.parse(response.body) as {
			code: string;
			message: string;
		};
		assert.equal(body.code, "invalid_request");
		assert.match(body.message, /OAuth connect flow/);
	});

	it("refuses a password create with no password as a 400", async () => {
		const response = await refusalOf(() =>
			assertPasswordProvided(AccountAuthType.Password, undefined),
		);

		assert.equal(response.statusCode, 400);
		const body = JSON.parse(response.body) as {
			code: string;
			message: string;
		};
		assert.equal(body.code, "invalid_request");
		assert.match(body.message, /password is required/);
	});

	it("refuses a create that omits authType and password alike", async () => {
		const response = await refusalOf(() =>
			assertPasswordProvided(undefined, undefined),
		);

		assert.equal(response.statusCode, 400);
	});

	it("lets a password create with a password through", () => {
		assert.doesNotThrow(() =>
			assertPasswordProvided(AccountAuthType.Password, "hunter2"),
		);
		assert.doesNotThrow(() => assertNotOAuthCreate(AccountAuthType.Password));
	});
});
