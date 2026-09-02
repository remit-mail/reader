/**
 * Issue #1065: what a request is allowed to leave behind in the log.
 *
 * A calendar feed's token is in its path and is the whole credential, so the
 * path is a secret; a validation failure is logged at error level and the
 * request it carries holds the caller's Authorization header. Both are asserted
 * against captured stdout rather than by reading the call sites, because the
 * leak was a field bound two frames away from the handler that logged it.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

// pino writes to `process.stdout` only when its `write` has been replaced, so
// the hook goes in before the logger is imported — which every import below
// does transitively. Writes pass through whenever nothing is capturing, so the
// test runner's own output still reaches the terminal.
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

process.env.LOG_LEVEL = "trace";

const { mintCalendarFeedToken } = await import("@remit/calendar-service");
const { _resetForTest, setClient } = await import("./service/data-client.js");
const { createCalendarSqliteClient } = await import(
	"./handlers/calendar-sqlite-fixture.js"
);

let handler: (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;
let cleanup: () => void;

const capture = async (
	run: () => Promise<APIGatewayProxyResult>,
): Promise<{ response: APIGatewayProxyResult; logged: string }> => {
	written.length = 0;
	capturing = true;
	try {
		const response = await run();
		return { response, logged: written.join("") };
	} finally {
		capturing = false;
	}
};

const send = (
	event: Partial<APIGatewayProxyEvent> & { httpMethod: string; path: string },
): Promise<APIGatewayProxyResult> =>
	handler(
		{
			headers: {},
			queryStringParameters: null,
			body: null,
			requestContext: {},
			...event,
		} as unknown as APIGatewayProxyEvent,
		{ awsRequestId: "log-redaction", functionName: "test" },
	);

before(async () => {
	_resetForTest();
	process.env.DATA_BACKEND = "sqlite";
	const fixture = await createCalendarSqliteClient();
	cleanup = fixture.cleanup;
	setClient(fixture.client);
	({ handler } = (await import("./index.js")) as unknown as {
		handler: typeof handler;
	});
});

after(() => {
	_resetForTest();
	process.stdout.write = originalWrite as typeof process.stdout.write;
	cleanup();
});

describe("what a request leaves in the log", () => {
	it("never writes the feed token a subscriber polls with", async () => {
		const { token } = mintCalendarFeedToken();

		const { response, logged } = await capture(() =>
			send({ httpMethod: "GET", path: `/feeds/calendar/${token}.ics` }),
		);

		assert.equal(
			response.statusCode,
			404,
			"an unknown token, but still routed",
		);
		assert.ok(logged.length > 0, "the request has to have logged something");
		assert.equal(
			logged.includes(token),
			false,
			"the token in the path is the credential, so the path cannot be a log field",
		);
		assert.ok(
			logged.includes("/feeds/calendar/<redacted>.ics"),
			"which route was served is what an operator reads the log for",
		);
	});

	it("never writes the credentials a failing request arrived with", async () => {
		// A session is already established, so the bearer is never verified and the
		// request reaches validation — where the whole parsed request, headers and
		// all, used to be logged. The delete refuses because it declares
		// `calendarId` as a required query parameter and none was sent.
		const { response, logged } = await capture(() =>
			send({
				httpMethod: "DELETE",
				path: "/calendar-events/8f14e45f-ceea-467a-9c9e-9c9e9c9e9c9e",
				headers: {
					Authorization: "Bearer x",
					Cookie: "session=secret-cookie-value",
				},
				requestContext: {
					authorizer: { claims: { sub: "log-redaction-sub" } },
				} as unknown as APIGatewayProxyEvent["requestContext"],
			}),
		);

		assert.equal(response.statusCode, 400, response.body);
		assert.ok(logged.includes("Validation failed"));
		assert.equal(logged.includes("Bearer x"), false);
		assert.equal(logged.includes("secret-cookie-value"), false);
		assert.equal(
			logged.includes("parsedRequest"),
			false,
			"the request that failed is not a field; its errors are",
		);
	});
});
