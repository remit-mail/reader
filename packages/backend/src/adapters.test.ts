import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import type { ApiConfig } from "./config/api-config.js";
import { testApiConfig } from "./config/test-config.js";
import { createCalendarSqliteClient } from "./handlers/calendar-sqlite-fixture.js";
import { handlers, publicHandlers } from "./handlers/index.js";
import { createApiEventHandler } from "./lambda.js";
import { type RequestHost, serveApi } from "./serve.js";
import type { RemitClient } from "./service/data-client.js";
import type { QueueName } from "./service/queues.js";
import type { HandlerIdentity } from "./types.js";

const SUB = "cognito-sub-adapters";
const EMAIL = "adapters@example.com";
const USER: HandlerIdentity = {
	kind: "user",
	accountConfigId: deriveAccountConfigId(SUB),
	sub: SUB,
	email: EMAIL,
};

const served = serveApi({ handlers, publicHandlers });

let client: RemitClient;
let cleanup: () => void;

interface Sent {
	method: string;
	path: string;
	query?: Record<string, readonly string[]>;
	headers?: Record<string, readonly string[]>;
	body?: unknown;
	signedIn: boolean;
	config?: ApiConfig;
}

interface Answer {
	status: number;
	allowOrigin: string | undefined;
	body: unknown;
}

const lastValues = (
	map: Record<string, readonly string[]>,
): Record<string, string | undefined> =>
	Object.fromEntries(
		Object.entries(map).map(([name, values]) => [name, values.at(-1)]),
	);

const parse = (text: string): unknown => (text === "" ? "" : JSON.parse(text));

const throughLambda = async (request: Sent): Promise<Answer> => {
	const headers = {
		"content-type": ["application/json"],
		...request.headers,
	};
	const viaLambda = createApiEventHandler(served, {
		config: request.config ?? testApiConfig(),
		localIdentity: { kind: "anonymous" },
		client: async () => client,
	});
	const result: APIGatewayProxyResult = await viaLambda(
		{
			httpMethod: request.method,
			path: request.path,
			queryStringParameters: request.query ? lastValues(request.query) : null,
			multiValueQueryStringParameters: request.query ?? null,
			headers: lastValues(headers),
			multiValueHeaders: headers,
			body: request.body === undefined ? null : JSON.stringify(request.body),
			requestContext: request.signedIn
				? { authorizer: { claims: { sub: SUB, email: EMAIL } } }
				: {},
		} as unknown as APIGatewayProxyEvent,
		{ awsRequestId: "adapters-lambda" } as Context,
	);
	return {
		status: result.statusCode,
		allowOrigin: result.headers?.["Access-Control-Allow-Origin"]?.toString(),
		body: parse(result.body),
	};
};

const throughFetch = async (request: Sent): Promise<Answer> => {
	const url = new URL(request.path, "https://reader.test");
	for (const [name, values] of Object.entries(request.query ?? {})) {
		for (const value of values) url.searchParams.append(name, value);
	}
	const headers = new Headers({ "content-type": "application/json" });
	for (const [name, values] of Object.entries(request.headers ?? {})) {
		for (const value of values) headers.append(name, value);
	}
	const host: RequestHost<QueueName> = {
		config: request.config ?? testApiConfig(),
		client: async () => client,
		identity: async () => (request.signedIn ? USER : { kind: "anonymous" }),
	};
	const response = await served.handleFetch(
		new Request(url, {
			method: request.method,
			headers,
			body:
				request.body === undefined ? undefined : JSON.stringify(request.body),
		}),
		host,
		"adapters-fetch",
	);
	return {
		status: response.status,
		allowOrigin:
			response.headers.get("Access-Control-Allow-Origin") ?? undefined,
		body: parse(await response.text()),
	};
};

const bothAnswer = async (request: Sent): Promise<Answer> => {
	const lambda = await throughLambda(request);
	const fetched = await throughFetch(request);
	assert.deepEqual(
		fetched,
		lambda,
		`${request.method} ${request.path} answers differently through the two adapters`,
	);
	return lambda;
};

before(async () => {
	({ client, cleanup } = await createCalendarSqliteClient());
});

after(() => {
	cleanup();
});

describe("the API Gateway and Fetch adapters", () => {
	let calendarId: string;

	before(async () => {
		const created = await throughLambda({
			method: "POST",
			path: "/calendars",
			body: { urlSegment: "adapters", displayName: "Adapters" },
			signedIn: true,
		});
		assert.equal(created.status, 200, JSON.stringify(created.body));
		calendarId = (created.body as { calendarId: string }).calendarId;
	});

	it("answer a list identically", async () => {
		const answer = await bothAnswer({
			method: "GET",
			path: "/calendars",
			signedIn: true,
		});
		assert.equal(answer.status, 200);
	});

	it("answer a detail identically", async () => {
		const answer = await bothAnswer({
			method: "GET",
			path: `/calendars/${calendarId}`,
			signedIn: true,
		});
		assert.equal(answer.status, 200);
		assert.equal(
			(answer.body as { calendarId: string }).calendarId,
			calendarId,
		);
	});

	it("answer a missing resource identically", async () => {
		const answer = await bothAnswer({
			method: "GET",
			path: `/calendars/${"0".repeat(calendarId.length)}`,
			signedIn: true,
		});
		assert.equal(answer.status, 404);
	});

	it("keep every value of a repeated query parameter", async () => {
		const answer = await bothAnswer({
			method: "GET",
			path: "/calendar-events",
			query: {
				from: ["2026-09-01T00:00:00Z"],
				to: ["2026-10-31T00:00:00Z"],
				calendarId: ["0".repeat(calendarId.length), calendarId],
			},
			signedIn: true,
		});
		assert.equal(answer.status, 404);
	});

	it("keep every value of a repeated header", async () => {
		const repeated = "https://a.test, https://b.test";
		const answer = await bothAnswer({
			method: "GET",
			path: "/calendars",
			headers: { origin: ["https://a.test", "https://b.test"] },
			signedIn: true,
			config: testApiConfig({
				corsAllowedOrigins: ["https://fallback.test", repeated],
			}),
		});
		assert.equal(answer.allowOrigin, repeated);
	});

	it("refuse a caller with no identity identically", async () => {
		const answer = await bothAnswer({
			method: "GET",
			path: "/calendars",
			signedIn: false,
		});
		assert.equal(answer.status, 401);
		assert.deepEqual(answer.body, {
			code: "unauthorized",
			message: "Unauthorized",
		});
	});
});
