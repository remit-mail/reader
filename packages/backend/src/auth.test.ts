import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { base36uuidv5, REMIT_NAMESPACE } from "@remit/remit-electrodb-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { deriveAccountConfigId as edgeDeriveAccountConfigId } from "../../../infra/constructs/cloudfront/remit-content-delivery/lambda-edge/handler.js";
import {
	deriveAccountConfigId,
	getAccountConfigIdFromEvent,
	getSubFromEvent,
} from "./auth.js";

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

// Byte-identity contract: the backend's accountConfigId derivation
// (`deriveAccountConfigId` in this file → `base36uuidv5` in
// `@remit/remit-electrodb-service`) and the Lambda@Edge's inline derivation
// (`infra/constructs/.../lambda-edge/handler.ts`) must produce identical
// output for the same Cognito `sub`. The literals (namespace UUID, prefix
// string, base36 alphabet) are duplicated in the Lambda@Edge bundle because
// it cannot import the workspace package — this test catches drift if
// either side ever changes the inputs. Canonical placeholders alice / bob /
// carol per `feedback_no_real_names`.
describe("deriveAccountConfigId byte-identity backend ↔ Lambda@Edge", () => {
	const subs = [
		"00000000-0000-0000-0000-aaaaaaaaaaaa", // alice
		"00000000-0000-0000-0000-bbbbbbbbbbbb", // bob
		"00000000-0000-0000-0000-cccccccccccc", // carol
	];

	for (const sub of subs) {
		it(`backend and Lambda@Edge derive byte-identical accountConfigId for ${sub}`, () => {
			const backend = deriveAccountConfigId(sub);
			const edge = edgeDeriveAccountConfigId(sub);
			assert.equal(
				edge,
				backend,
				`drift between backend and Lambda@Edge derivation for sub ${sub}`,
			);
		});
	}

	it("backend's deriveAccountConfigId is a thin wrapper around base36uuidv5(`account:${sub}`, REMIT_NAMESPACE)", () => {
		// Anchors the contract on the backend side: if `auth.ts` ever changes
		// the prefix string or namespace, the Lambda@Edge byte-identity tests
		// above would diverge — but only if Lambda@Edge stays correct. This
		// extra check pins the backend to the documented derivation.
		const sub = "00000000-0000-0000-0000-aaaaaaaaaaaa";
		const expected = base36uuidv5(`account:${sub}`, REMIT_NAMESPACE);
		assert.equal(deriveAccountConfigId(sub), expected);
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

describe("getSubFromEvent", () => {
	const originalCognitoSub = process.env.LOCAL_COGNITO_SUB;

	beforeEach(() => {
		delete process.env.LOCAL_COGNITO_SUB;
	});

	afterEach(() => {
		if (originalCognitoSub === undefined) {
			delete process.env.LOCAL_COGNITO_SUB;
		} else {
			process.env.LOCAL_COGNITO_SUB = originalCognitoSub;
		}
	});

	it("returns the Cognito sub from JWT claims", () => {
		assert.equal(getSubFromEvent(makeEvent({ sub: "user-42" })), "user-42");
	});

	it("falls back to LOCAL_COGNITO_SUB when no claim is present", () => {
		process.env.LOCAL_COGNITO_SUB = "local-sub";
		assert.equal(getSubFromEvent(makeEvent()), "local-sub");
	});

	it("returns undefined when neither source is available", () => {
		assert.equal(getSubFromEvent(makeEvent()), undefined);
	});

	it("returns undefined for an empty string sub claim with no env fallback", () => {
		assert.equal(getSubFromEvent(makeEvent({ sub: "" })), undefined);
	});
});
