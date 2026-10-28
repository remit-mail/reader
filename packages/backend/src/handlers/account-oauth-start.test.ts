/**
 * What an operator can tell from the log when the Microsoft OAuth start fails.
 *
 * Every credential failure answers the same 500 with the same body, so the
 * backend log for that request is the only place a secret that cannot be read
 * is named. An instance with no Microsoft app registered answers 501 instead. Driven through the real handler so what is
 * asserted is the line a deployment actually writes, correlation id and all.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { withTelemetry } from "@remit/logger-lambda/node";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { lambdaHandler } from "../api-fixture.js";
import type { MsOAuthConfig } from "../config/msoauth.js";
import { msOAuthCredentialsFromSecret } from "../config/msoauth-secrets-manager.js";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import { captureStdout, restoreStdout } from "../stdout-capture-fixture.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

const WEB_ORIGIN = "https://mail.example.com";
const START_PATH = "/accounts/oauth/microsoft/start";
const SECRET_ARN =
	"arn:aws:secretsmanager:eu-west-1:000000000000:secret:msoauth-AbCdEf";

const FROM_SECRET: MsOAuthConfig = {
	mode: "Enabled",
	redirectUri: `${WEB_ORIGIN}/accounts/oauth/microsoft/callback`,
	overrides: {},
	credentials: msOAuthCredentialsFromSecret(SECRET_ARN),
};

const originalSend = SecretsManagerClient.prototype.send;
let secretString: string | undefined;
let client: RemitClient;
let cleanup: () => void;

interface Outcome {
	response: APIGatewayProxyResult;
	log: string;
	logged: string;
}

const headerOf = (
	response: APIGatewayProxyResult,
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		if (key.toLowerCase() === name) return String(value);
	}
	return undefined;
};

const startRequest = (
	msOAuth: MsOAuthConfig,
	awsRequestId: string,
): Promise<APIGatewayProxyResult> =>
	withTelemetry(
		lambdaHandler(
			async () => client,
			testApiConfig({ corsAllowedOrigins: [WEB_ORIGIN], msOAuth }),
		),
	)(
		{
			httpMethod: "POST",
			path: START_PATH,
			headers: {},
			queryStringParameters: null,
			body: JSON.stringify({ email: "matthijs@example.com" }),
			requestContext: {
				authorizer: {
					claims: { sub: "cognito-sub", email: "person@example.com" },
				},
			},
		} as unknown as APIGatewayProxyEvent,
		{ awsRequestId, functionName: "test" } as Context,
	);

const start = async (msOAuth: MsOAuthConfig): Promise<Outcome> => {
	const awsRequestId = `req-${randomUUID()}`;
	const { result: response, logged } = await captureStdout(() =>
		startRequest(msOAuth, awsRequestId),
	);

	assert.equal(
		headerOf(response, "x-correlation-id"),
		awsRequestId,
		"the id the client reports has to be the id the log lines carry",
	);

	const forThisRequest = logged
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((line) => line.requestId === awsRequestId);

	assert.ok(
		forThisRequest.length > 0,
		"the failure left no line carrying the correlation id the client was handed",
	);

	return { response, log: JSON.stringify(forThisRequest), logged };
};

const NO_APP_REGISTERED =
	"No Microsoft OAuth credentials are configured on this instance";
const SECRET_UNREADABLE =
	"does not hold a JSON object with a non-empty clientId and clientSecret";

const assertNamesOnly = (log: string, condition: string): void => {
	assert.ok(
		log.includes(condition),
		`the log for this request never says ${condition}: ${log}`,
	);
	const other =
		condition === NO_APP_REGISTERED ? SECRET_UNREADABLE : NO_APP_REGISTERED;
	assert.ok(
		!log.includes(other),
		"the log also says the other condition, so the two are indistinguishable",
	);
};

const assertGenericFiveHundred = (response: APIGatewayProxyResult): void => {
	assert.equal(response.statusCode, 500);
	assert.deepEqual(JSON.parse(response.body), {
		code: "internal_error",
		message: "Internal server error",
	});
};

before(async () => {
	process.env.LOG_LEVEL = "error";

	SecretsManagerClient.prototype.send = (async () => ({
		SecretString: secretString,
	})) as typeof SecretsManagerClient.prototype.send;

	({ client, cleanup } = await createCalendarSqliteClient());
});

after(() => {
	cleanup();
	SecretsManagerClient.prototype.send = originalSend;
	restoreStdout();
});

describe("a Microsoft OAuth start on an instance with no Microsoft app", () => {
	it("answers 501 not_configured, a refusal the wizard can show", async () => {
		const response = await startRequest(
			{ mode: "Disabled" },
			`req-${randomUUID()}`,
		);

		assert.equal(response.statusCode, 501);
		assert.equal(JSON.parse(response.body).code, "not_configured");
	});
});

describe("a Microsoft OAuth start that cannot load its credentials", () => {
	for (const [condition, value] of [
		["carries no string value", undefined],
		["lacks a credential field", JSON.stringify({ clientId: "an-app-id" })],
	] as const) {
		it(`says the secret is unreadable when it ${condition}`, async () => {
			secretString = value;

			const { response, log } = await start(FROM_SECRET);

			assertGenericFiveHundred(response);
			assertNamesOnly(log, SECRET_UNREADABLE);
		});
	}

	it("says a secret that is not JSON is unreadable without quoting what it holds", async () => {
		const secretMaterial = "s3cr3t-not-json-9d41c0b7";
		secretString = secretMaterial;

		const { response, log, logged } = await start(FROM_SECRET);

		assertGenericFiveHundred(response);
		assertNamesOnly(log, SECRET_UNREADABLE);
		assert.equal(
			logged.includes(secretMaterial),
			false,
			"a parse failure quoting the secret into the log turns a misconfiguration into a leak",
		);
	});
});
