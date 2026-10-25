import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context as LambdaContext,
} from "aws-lambda";
import type { Context } from "openapi-backend";
import { lambdaHandler } from "../api-fixture.js";
import type { ApiConfig } from "../config/api-config.js";
import { testApiConfig } from "../config/test-config.js";
import { formatResponse } from "../response.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import type { HandlerContext } from "../types.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import { SystemOperations } from "./system-update.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	".tmp",
	"system-update",
);

const USER = "any-signed-in-user";

let controlDir: string;

const okState = {
	currentVersion: "v1.4.1",
	check: {
		status: "ok",
		lastCheckedAt: "2026-07-20T08:00:00Z",
		latestVersion: "v1.5.0",
		publishedAt: "2026-07-18T09:00:00Z",
		summary: "Faster search.",
		releaseNotesUrl: "https://example.com/notes",
		updateAvailable: true,
	},
	run: null,
};

const writeState = (state: unknown): void => {
	writeFileSync(join(controlDir, "state.json"), JSON.stringify(state));
};

let client: RemitClient;
let cleanup: () => void;
let config: ApiConfig;

before(async () => {
	mkdirSync(tmpRoot, { recursive: true });
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
});

after(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
	_resetForTest();
	cleanup();
});

beforeEach(() => {
	controlDir = mkdtempSync(join(tmpRoot, "control-"));
	config = testApiConfig({
		updateControlDir: controlDir,
		selfUpdate: "Enabled",
	});
});

const callerOf = (sub: string): HandlerContext => ({
	client,
	config,
	identity: {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email: `${sub}@example.com`,
	},
});

const throughPipeline = async (
	event: Record<string, unknown> & { httpMethod: string },
): Promise<APIGatewayProxyResult> => {
	const full = {
		path: "/system/update",
		queryStringParameters: null,
		headers: {},
		body: null,
		requestContext: {},
		...event,
	} as unknown as APIGatewayProxyEvent;
	const handleApiEvent = lambdaHandler(async () => client, config);
	return handleApiEvent(full, {
		awsRequestId: "system-update-test",
	} as LambdaContext);
};

const getAnonymously = (query: Record<string, string> | null = null) =>
	throughPipeline({ httpMethod: "GET", queryStringParameters: query });

const applyAnonymously = (targetVersion: string) =>
	throughPipeline({
		httpMethod: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ targetVersion }),
	});

// The query as openapi-backend hands it over: validated and coerced against the
// spec, so `refresh` reaches the handler as a boolean or not at all.
const getContext = (query: Record<string, unknown> = {}): Context =>
	({ request: { query } }) as unknown as Context;

const postContext = (targetVersion: string): Context =>
	({ request: { requestBody: { targetVersion } } }) as unknown as Context;

const getUpdate = (
	caller: HandlerContext,
	query: Record<string, unknown> = {},
): Promise<unknown> =>
	SystemOperations.SystemOperations_getSystemUpdate(getContext(query), caller);

const applyUpdate = (
	targetVersion: string,
	caller: HandlerContext,
): Promise<unknown> =>
	SystemOperations.SystemOperations_applySystemUpdate(
		postContext(targetVersion),
		caller,
	);

const hasStatus = (value: unknown, code: number): boolean =>
	typeof value === "object" &&
	value !== null &&
	(value as { statusCode?: number }).statusCode === code;

describe("GET /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		config = { ...config, selfUpdate: "Disabled" };

		const result = await getUpdate(callerOf(USER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 401 when the caller is not authenticated", async () => {
		writeState(okState);

		const result = await getAnonymously();

		assert.equal(result.statusCode, 401);
	});

	it("returns 200 for any authenticated caller", async () => {
		writeState(okState);

		const result = await getUpdate(callerOf("another-signed-in-user"));

		assert.deepEqual(result, okState);
	});

	it("returns 200 with the state file verbatim", async () => {
		writeState(okState);

		const result = await getUpdate(callerOf(USER));

		assert.deepEqual(result, okState);
	});

	it("records a check request on the control volume when refresh is set (#599)", async () => {
		writeState(okState);

		const result = await getUpdate(callerOf(USER), { refresh: true });

		// The press reaches the updater through the seam, and the answer is the
		// stored state — lastCheckedAt included, so the panel can say how old the
		// verdict it is still showing is.
		const file = readFileSync(join(controlDir, "check-request.json"), "utf8");
		assert.deepEqual(JSON.parse(file), {});
		assert.deepEqual(result, okState);
	});

	it("records a check request over an unknown version when no state exists yet", async () => {
		const result = await getUpdate(callerOf(USER), { refresh: true });

		assert.equal(existsSync(join(controlDir, "check-request.json")), true);
		assert.deepEqual(result, {
			currentVersion: "unknown",
			check: { status: "disabled" },
			run: null,
		});
	});

	it("records nothing when the query carries no refresh", async () => {
		// `?refresh=1` is rejected by the spec before it reaches here, so the only
		// value that records a request is the boolean the validator produced.
		writeState(okState);

		await getUpdate(callerOf(USER));

		assert.equal(existsSync(join(controlDir, "check-request.json")), false);
	});

	it("returns 401 and records nothing when a refresh is not authenticated", async () => {
		writeState(okState);

		const result = await getAnonymously({ refresh: "true" });

		assert.equal(result.statusCode, 401);
		assert.equal(existsSync(join(controlDir, "check-request.json")), false);
	});

	it("reports an unknown version when no state file exists", async () => {
		// The updater owns the running version and writes it into state.json; with
		// no state file the backend has nothing authoritative, so it says unknown.
		const result = await getUpdate(callerOf(USER));

		assert.deepEqual(result, {
			currentVersion: "unknown",
			check: { status: "disabled" },
			run: null,
		});
	});

	it("returns 200 with the run block untouched when the check has failed", async () => {
		const run = {
			runId: "run-1",
			fromVersion: "v1.3.0",
			targetVersion: "v1.4.1",
			phase: "committing",
			outcome: "succeeded",
			startedAt: "2026-07-19T08:00:00Z",
			updatedAt: "2026-07-19T08:05:00Z",
			message: "Update installed.",
			logCommand: "remit logs backend",
		};
		writeState({
			currentVersion: "v1.4.1",
			check: {
				status: "failed",
				lastCheckedAt: "2026-07-20T08:00:00Z",
				error: "The update manifest could not be fetched.",
			},
			run,
		});

		const result = (await getUpdate(callerOf(USER))) as {
			check: { status: string };
			run: unknown;
		};

		assert.equal(result.check.status, "failed");
		assert.deepEqual(result.run, run);
	});

	it("passes both schema-version fields through when the state file carries them", async () => {
		writeState({
			currentVersion: "v1.4.1",
			currentSchemaVersion: 5,
			check: { ...okState.check, schemaVersion: 6 },
			run: null,
		});

		const result = (await getUpdate(callerOf(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.equal(result.currentSchemaVersion, 5);
		assert.equal(result.check.schemaVersion, 6);
	});

	it("omits both schema-version fields when the state file predates them", async () => {
		writeState(okState);

		const result = (await getUpdate(callerOf(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.ok(!("currentSchemaVersion" in result));
		assert.ok(!("schemaVersion" in result.check));
	});

	it("carries currentSchemaVersion alone when the check has no schema version", async () => {
		writeState({
			currentVersion: "v1.4.1",
			currentSchemaVersion: 5,
			check: okState.check,
			run: null,
		});

		const result = (await getUpdate(callerOf(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.equal(result.currentSchemaVersion, 5);
		assert.ok(!("schemaVersion" in result.check));
	});

	it("carries check.schemaVersion alone when currentSchemaVersion is absent", async () => {
		writeState({
			currentVersion: "v1.4.1",
			check: { ...okState.check, schemaVersion: 6 },
			run: null,
		});

		const result = (await getUpdate(callerOf(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.ok(!("currentSchemaVersion" in result));
		assert.equal(result.check.schemaVersion, 6);
	});
});

describe("POST /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		config = { ...config, selfUpdate: "Disabled" };

		const result = await applyUpdate("v1.5.0", callerOf(USER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 401 without writing request.json when the caller is not authenticated", async () => {
		writeState(okState);

		const result = await applyAnonymously("v1.5.0");

		assert.equal(result.statusCode, 401);
		assert.throws(() => readFileSync(join(controlDir, "request.json"), "utf8"));
	});

	it("returns 202 for any authenticated caller and records that identity", async () => {
		writeState(okState);

		const result = (await applyUpdate(
			"v1.5.0",
			callerOf("another-signed-in-user"),
		)) as { statusCode: number };

		assert.equal(result.statusCode, 202);

		const request = JSON.parse(
			readFileSync(join(controlDir, "request.json"), "utf8"),
		);
		assert.equal(request.requestedBy, "another-signed-in-user");
	});

	it("returns 409 when a run is already in flight", async () => {
		writeState({
			...okState,
			run: {
				runId: "run-9",
				fromVersion: "v1.4.1",
				targetVersion: "v1.5.0",
				phase: "verifying",
				outcome: null,
				startedAt: "2026-07-20T08:01:00Z",
				updatedAt: "2026-07-20T08:04:00Z",
				message: "Waiting for the new version to answer.",
				logCommand: "remit logs backend",
			},
		});

		await assert.rejects(applyUpdate("v1.5.0", callerOf(USER)), {
			statusCode: 409,
		});
	});

	it("returns 422 when the target is not the checked version", async () => {
		writeState(okState);

		await assert.rejects(applyUpdate("v9.9.9", callerOf(USER)), {
			statusCode: 422,
		});
	});

	it("returns 422 when no check has ever succeeded", async () => {
		await assert.rejects(applyUpdate("v1.5.0", callerOf(USER)), {
			statusCode: 422,
		});
	});

	it("returns 202 with a run block carrying a fresh runId", async () => {
		writeState(okState);

		const result = (await applyUpdate("v1.5.0", callerOf(USER))) as {
			statusCode: number;
			body: { run: { runId: string; targetVersion: string; outcome: null } };
		};

		assert.equal(result.statusCode, 202);
		assert.equal(result.body.run.targetVersion, "v1.5.0");
		assert.equal(result.body.run.outcome, null);
		assert.ok(result.body.run.runId.length > 0);
	});

	it("writes request.json with exactly the four seam fields and nothing else", async () => {
		writeState(okState);

		await applyUpdate("v1.5.0", callerOf(USER));

		const request = JSON.parse(
			readFileSync(join(controlDir, "request.json"), "utf8"),
		);

		assert.deepEqual(Object.keys(request).sort(), [
			"requestedAt",
			"requestedBy",
			"runId",
			"targetVersion",
		]);
		assert.equal(request.targetVersion, "v1.5.0");
		assert.equal(request.requestedBy, USER);
		for (const forbidden of ["registry", "image", "digest"]) {
			assert.ok(!(forbidden in request));
		}
	});

	it("stamps requestedAt with the moment of the request, in UTC", async () => {
		// The updater installs a request only while it is still current (#587), so
		// requestedAt is the field that decides it. A missing, fixed or non-UTC
		// stamp would make every request expire on arrival.
		writeState(okState);
		const before = Date.now();

		await applyUpdate("v1.5.0", callerOf(USER));

		const after = Date.now();
		const request = JSON.parse(
			readFileSync(join(controlDir, "request.json"), "utf8"),
		) as { requestedAt: string };

		assert.match(
			request.requestedAt,
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
		);
		const stamped = Date.parse(request.requestedAt);
		assert.ok(stamped >= before - 1000 && stamped <= after + 1000);
	});
});

describe("GET /system/update through the whole request pipeline", () => {
	it("records the check for ?refresh=true off the wire", async () => {
		// The rest of this file hands the handler a query the validator has already
		// coerced. Here the query arrives as API Gateway delivers it — every value a
		// string — and goes through the real built spec, which is where the press
		// was being answered with 400 instead of reaching the handler at all.
		writeState(okState);

		const result = await throughPipeline({
			httpMethod: "GET",
			queryStringParameters: { refresh: "true" },
			requestContext: {
				authorizer: { claims: { sub: USER, email: "user@example.com" } },
			},
		});

		assert.equal(result.statusCode, 200);
		assert.deepEqual(
			JSON.parse(readFileSync(join(controlDir, "check-request.json"), "utf8")),
			{},
		);
		assert.deepEqual(JSON.parse(result.body), okState);
	});
});

// A refusal here is the object `formatResponse` unwraps, never one that has
// already been serialized: handing it a `body` string publishes the envelope
// itself — `{"statusCode":…,"headers":…,"body":"{…}"}` — and what the caller
// then parses is not an ApiError at all. Only the status was ever asserted, so
// the shape went unguarded (issue #371).
describe("the wire body of a self-update refusal", () => {
	it("answers an unconfigured seam with a flat not_found", async () => {
		config = { ...config, selfUpdate: "Disabled" };

		const result = await getUpdate(callerOf(USER));
		const wire = formatResponse(result as Record<string, unknown>);

		assert.equal(wire.statusCode, 404);
		assert.deepEqual(JSON.parse(wire.body), {
			code: "not_found",
			message: "Not found",
		});
	});

	it("answers an unauthenticated caller with a flat unauthorized", async () => {
		writeState(okState);

		const wire = await getAnonymously();

		assert.equal(wire.statusCode, 401);
		assert.deepEqual(JSON.parse(wire.body), {
			code: "unauthorized",
			message: "Unauthorized",
		});
	});

	it("answers an unauthenticated install request the same way", async () => {
		writeState(okState);

		const wire = await applyAnonymously("v1.5.0");

		assert.equal(wire.statusCode, 401);
		assert.deepEqual(JSON.parse(wire.body), {
			code: "unauthorized",
			message: "Unauthorized",
		});
	});
});
