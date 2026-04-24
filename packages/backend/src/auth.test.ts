import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { deriveAccountConfigId, getAccountConfigIdFromEvent } from "./auth.js";

const makeEvent = (claims?: Record<string, unknown>): APIGatewayProxyEvent => {
	const authorizer = claims ? { claims } : undefined;
	return {
		requestContext: { authorizer },
	} as unknown as APIGatewayProxyEvent;
};

describe("deriveAccountConfigId", () => {
	it("is deterministic for the same sub", () => {
		const sub = "1c1ab2e0-7ab0-4a9f-8a00-93dbb30a1d1b";
		assert.equal(deriveAccountConfigId(sub), deriveAccountConfigId(sub));
	});

	it("produces different ids for different subs", () => {
		const a = deriveAccountConfigId("sub-a");
		const b = deriveAccountConfigId("sub-b");
		assert.notEqual(a, b);
	});

	it("produces a non-empty base36 id", () => {
		const id = deriveAccountConfigId("some-sub");
		assert.equal(typeof id, "string");
		assert.ok(id.length > 0);
		assert.match(id, /^[0-9a-z]+$/);
	});
});

describe("getAccountConfigIdFromEvent", () => {
	const originalAccountConfigId = process.env.LOCAL_ACCOUNT_CONFIG_ID;
	const originalCognitoSub = process.env.LOCAL_COGNITO_SUB;

	beforeEach(() => {
		delete process.env.LOCAL_ACCOUNT_CONFIG_ID;
		delete process.env.LOCAL_COGNITO_SUB;
	});

	afterEach(() => {
		if (originalAccountConfigId === undefined) {
			delete process.env.LOCAL_ACCOUNT_CONFIG_ID;
		} else {
			process.env.LOCAL_ACCOUNT_CONFIG_ID = originalAccountConfigId;
		}
		if (originalCognitoSub === undefined) {
			delete process.env.LOCAL_COGNITO_SUB;
		} else {
			process.env.LOCAL_COGNITO_SUB = originalCognitoSub;
		}
	});

	it("derives accountConfigId from the Cognito sub claim", () => {
		const sub = "cognito-user-1";
		const id = getAccountConfigIdFromEvent(makeEvent({ sub }));
		assert.equal(id, deriveAccountConfigId(sub));
	});

	it("prefers the sub claim over any local env overrides", () => {
		process.env.LOCAL_ACCOUNT_CONFIG_ID = "pinned-config-id";
		process.env.LOCAL_COGNITO_SUB = "unused-sub";
		const sub = "real-sub";
		const id = getAccountConfigIdFromEvent(makeEvent({ sub }));
		assert.equal(id, deriveAccountConfigId(sub));
	});

	it("falls back to LOCAL_ACCOUNT_CONFIG_ID when no claims are present", () => {
		process.env.LOCAL_ACCOUNT_CONFIG_ID = "pinned-config-id";
		assert.equal(getAccountConfigIdFromEvent(makeEvent()), "pinned-config-id");
	});

	it("falls back to deriving from LOCAL_COGNITO_SUB when no pinned id is set", () => {
		process.env.LOCAL_COGNITO_SUB = "local-sub";
		assert.equal(
			getAccountConfigIdFromEvent(makeEvent()),
			deriveAccountConfigId("local-sub"),
		);
	});

	it("throws when no sub and no local overrides are available", () => {
		assert.throws(
			() => getAccountConfigIdFromEvent(makeEvent()),
			/Missing accountConfigId/,
		);
	});

	it("ignores an empty string sub claim", () => {
		process.env.LOCAL_ACCOUNT_CONFIG_ID = "pinned-config-id";
		assert.equal(
			getAccountConfigIdFromEvent(makeEvent({ sub: "" })),
			"pinned-config-id",
		);
	});
});
