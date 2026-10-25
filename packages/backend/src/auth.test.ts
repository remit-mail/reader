import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { APIGatewayProxyEvent } from "aws-lambda";
import {
	assertLocalBypassNotInDeployedEnv,
	getIdentityFromEvent,
	localIdentityFromEnv,
} from "./auth.js";

const noClaims = { requestContext: {} } as unknown as APIGatewayProxyEvent;

describe("the local auth bypass", () => {
	for (const name of ["LOCAL_ACCOUNT_CONFIG_ID", "LOCAL_COGNITO_SUB"]) {
		it(`refuses to start with ${name} and no LOCAL_EMAIL`, () => {
			assert.throws(
				() =>
					assertLocalBypassNotInDeployedEnv({
						NODE_ENV: "test",
						[name]: "pinned",
					}),
				/without LOCAL_EMAIL/,
			);
		});
	}

	it("serves a pinned accountConfigId as a user with that id as its sub", () => {
		const env = {
			NODE_ENV: "test",
			LOCAL_ACCOUNT_CONFIG_ID: "config-1",
			LOCAL_EMAIL: "dev@example.com",
		};
		assertLocalBypassNotInDeployedEnv(env);

		assert.deepEqual(
			getIdentityFromEvent(noClaims, localIdentityFromEnv(env)),
			{
				kind: "user",
				accountConfigId: "config-1",
				sub: "config-1",
				email: "dev@example.com",
			},
		);
	});

	it("derives the accountConfigId from a pinned sub", () => {
		const env = {
			NODE_ENV: "test",
			LOCAL_COGNITO_SUB: "sub-1",
			LOCAL_EMAIL: "dev@example.com",
		};

		assert.deepEqual(
			getIdentityFromEvent(noClaims, localIdentityFromEnv(env)),
			{
				kind: "user",
				accountConfigId: deriveAccountConfigId("sub-1"),
				sub: "sub-1",
				email: "dev@example.com",
			},
		);
	});

	it("leaves a request with no claims and no bypass anonymous", () => {
		assert.deepEqual(
			getIdentityFromEvent(
				noClaims,
				localIdentityFromEnv({ NODE_ENV: "test" }),
			),
			{
				kind: "anonymous",
			},
		);
	});
});
