/**
 * What an operator can tell from the log when the Microsoft OAuth start fails.
 *
 * Every credential failure answers the same 500 with the same body, so the
 * backend log for that request is the only place the three are told apart: an
 * instance with no Microsoft app registered must not read like a live outage.
 * Driven through the real handler so what is asserted is the line a deployment
 * actually writes, correlation id and all.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const WEB_ORIGIN = "https://mail.example.com";
const START_PATH = "/accounts/oauth/microsoft/start";
const SECRET_ARN =
	"arn:aws:secretsmanager:eu-west-1:000000000000:secret:msoauth-AbCdEf";

// pino writes through `process.stdout` once its `write` is replaced, so the hook
// has to be installed before the logger is imported; it passes writes through
// whenever a test is not capturing so the runner's own output still shows up.
const originalWrite = process.stdout.write.bind(process.stdout);
const written: string[] = [];
let capturing = false;

process.stdout.write = ((
	chunk: string | Uint8Array,
	...rest: unknown[]
): boolean => {
	if (capturing && typeof chunk === "string") {
		written.push(chunk);
		return true;
	}
	return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

let handler: (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;

const originalSend = SecretsManagerClient.prototype.send;
let secretString: string | undefined;

interface Outcome {
	response: APIGatewayProxyResult;
	log: string;
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

const start = async (): Promise<Outcome> => {
	const awsRequestId = `req-${randomUUID()}`;
	written.length = 0;
	capturing = true;
	let response: APIGatewayProxyResult;
	try {
		response = await handler(
			{
				httpMethod: "POST",
				path: START_PATH,
				headers: {},
				queryStringParameters: null,
				body: JSON.stringify({ email: "matthijs@example.com" }),
				requestContext: { authorizer: { claims: { sub: "cognito-sub" } } },
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId, functionName: "test" },
		);
	} finally {
		capturing = false;
	}

	assert.equal(
		headerOf(response, "x-correlation-id"),
		awsRequestId,
		"the id the client reports has to be the id the log lines carry",
	);

	const forThisRequest = written
		.join("")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((line) => line.requestId === awsRequestId);

	assert.ok(
		forThisRequest.length > 0,
		"the failure left no line carrying the correlation id the client was handed",
	);

	return { response, log: JSON.stringify(forThisRequest) };
};

/** The name each condition, and only that condition, puts in the log. */
const NO_APP_REGISTERED = "MicrosoftOAuthNotConfigured";
const SECRET_HAS_NO_STRING = "MicrosoftOAuthSecretEmpty";
const SECRET_MISSING_FIELDS = "MicrosoftOAuthSecretIncomplete";

const CONDITIONS = [
	NO_APP_REGISTERED,
	SECRET_HAS_NO_STRING,
	SECRET_MISSING_FIELDS,
];

const assertNamesOnly = (log: string, condition: string): void => {
	assert.ok(
		log.includes(condition),
		`the log for this request never names the condition ${condition}: ${log}`,
	);
	for (const other of CONDITIONS) {
		if (other === condition) continue;
		assert.ok(
			!log.includes(other),
			`the log also names ${other}, so the two conditions are indistinguishable`,
		);
	}
};

const assertGenericFiveHundred = (response: APIGatewayProxyResult): void => {
	assert.equal(response.statusCode, 500);
	assert.deepEqual(JSON.parse(response.body), {
		message: "Internal server error",
	});
};

before(async () => {
	process.env.LOG_LEVEL = "error";
	process.env.DATA_BACKEND = "sqlite";
	process.env.CORS_ALLOWED_ORIGINS = WEB_ORIGIN;
	process.env.MSOAUTH_REDIRECT_URI = `${WEB_ORIGIN}/accounts/oauth/microsoft/callback`;

	SecretsManagerClient.prototype.send = (async () => ({
		SecretString: secretString,
	})) as typeof SecretsManagerClient.prototype.send;

	({ handler } = (await import("../index.js")) as unknown as {
		handler: typeof handler;
	});
});

after(() => {
	SecretsManagerClient.prototype.send = originalSend;
	process.stdout.write = originalWrite as typeof process.stdout.write;
});

describe("a Microsoft OAuth start that cannot load its credentials", () => {
	it("names an instance with no Microsoft app registered", async () => {
		delete process.env.MSOAUTH_CLIENT_ID;
		delete process.env.MSOAUTH_CLIENT_SECRET;
		delete process.env.MSOAUTH_SECRET_ARN;

		const { response, log } = await start();

		assertGenericFiveHundred(response);
		assertNamesOnly(log, NO_APP_REGISTERED);
	});

	it("names a secret that carries no string value", async () => {
		delete process.env.MSOAUTH_CLIENT_ID;
		delete process.env.MSOAUTH_CLIENT_SECRET;
		process.env.MSOAUTH_SECRET_ARN = SECRET_ARN;
		secretString = undefined;

		const { response, log } = await start();

		assertGenericFiveHundred(response);
		assertNamesOnly(log, SECRET_HAS_NO_STRING);
	});

	it("names a secret whose credential fields are absent", async () => {
		delete process.env.MSOAUTH_CLIENT_ID;
		delete process.env.MSOAUTH_CLIENT_SECRET;
		process.env.MSOAUTH_SECRET_ARN = SECRET_ARN;
		secretString = JSON.stringify({ clientId: "an-app-id" });

		const { response, log } = await start();

		assertGenericFiveHundred(response);
		assertNamesOnly(log, SECRET_MISSING_FIELDS);
	});
});
