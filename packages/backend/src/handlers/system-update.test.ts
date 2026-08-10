import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { SystemOperations } from "./system-update.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	".tmp",
	"system-update",
);

const USER = "any-signed-in-user";
const MANIFEST_URL = "https://updates.example.com/stable.json";

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

before(() => {
	mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
	controlDir = mkdtempSync(join(tmpRoot, "control-"));
	process.env.REMIT_UPDATE_CONTROL_DIR = controlDir;
	process.env.REMIT_UPDATE_MANIFEST_URL = MANIFEST_URL;
	process.env.REMIT_TAG = "v1.4.1";
});

afterEach(() => {
	delete process.env.REMIT_UPDATE_MANIFEST_URL;
	delete process.env.REMIT_UPDATE_CONTROL_DIR;
	delete process.env.REMIT_TAG;
});

const buildEvent = (sub?: string): APIGatewayProxyEvent =>
	({
		headers: {},
		requestContext: sub ? { authorizer: { claims: { sub } } } : {},
	}) as unknown as APIGatewayProxyEvent;

const postContext = (targetVersion: string): Context =>
	({ request: { requestBody: { targetVersion } } }) as unknown as Context;

const getSystemUpdate =
	SystemOperations.SystemOperations_getSystemUpdate as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<unknown>;

const applySystemUpdate =
	SystemOperations.SystemOperations_applySystemUpdate as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<unknown>;

const requestSystemUpdateCheck =
	SystemOperations.SystemOperations_requestSystemUpdateCheck as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<unknown>;

const getUpdate = (event: APIGatewayProxyEvent) =>
	getSystemUpdate({} as unknown as Context, event);

const applyUpdate = (targetVersion: string, event: APIGatewayProxyEvent) =>
	applySystemUpdate(postContext(targetVersion), event);

const requestCheck = (event: APIGatewayProxyEvent) =>
	requestSystemUpdateCheck({} as unknown as Context, event);

const writeCheckRequestFile = (fields: Record<string, unknown>): void => {
	writeFileSync(join(controlDir, "check-request.json"), JSON.stringify(fields));
};

const hasStatus = (value: unknown, code: number): boolean =>
	typeof value === "object" &&
	value !== null &&
	(value as { statusCode?: number }).statusCode === code;

describe("GET /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		delete process.env.REMIT_UPDATE_MANIFEST_URL;

		const result = await getUpdate(buildEvent(USER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 401 when the caller is not authenticated", async () => {
		writeState(okState);

		const result = await getUpdate(buildEvent());

		assert.ok(hasStatus(result, 401));
	});

	it("returns 200 for any authenticated caller", async () => {
		writeState(okState);

		const result = await getUpdate(buildEvent("another-signed-in-user"));

		assert.deepEqual(result, okState);
	});

	it("returns 200 with the state file verbatim", async () => {
		writeState(okState);

		const result = await getUpdate(buildEvent(USER));

		assert.deepEqual(result, okState);
	});

	it("reports an unknown version, not its own process env, when no state file exists", async () => {
		// The updater owns the running version and writes it into state.json; with
		// no state file the backend has nothing authoritative, so it says unknown
		// rather than surfacing REMIT_TAG, which drifts from the real running tag.
		const result = await getUpdate(buildEvent(USER));

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

		const result = (await getUpdate(buildEvent(USER))) as {
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

		const result = (await getUpdate(buildEvent(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.equal(result.currentSchemaVersion, 5);
		assert.equal(result.check.schemaVersion, 6);
	});

	it("omits both schema-version fields when the state file predates them", async () => {
		writeState(okState);

		const result = (await getUpdate(buildEvent(USER))) as {
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

		const result = (await getUpdate(buildEvent(USER))) as {
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

		const result = (await getUpdate(buildEvent(USER))) as {
			currentSchemaVersion?: number;
			check: { schemaVersion?: number };
		};

		assert.ok(!("currentSchemaVersion" in result));
		assert.equal(result.check.schemaVersion, 6);
	});
});

describe("POST /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		delete process.env.REMIT_UPDATE_MANIFEST_URL;

		const result = await applyUpdate("v1.5.0", buildEvent(USER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 401 without writing request.json when the caller is not authenticated", async () => {
		writeState(okState);

		const result = await applyUpdate("v1.5.0", buildEvent());

		assert.ok(hasStatus(result, 401));
		assert.throws(() => readFileSync(join(controlDir, "request.json"), "utf8"));
	});

	it("returns 202 for any authenticated caller and records that identity", async () => {
		writeState(okState);

		const result = (await applyUpdate(
			"v1.5.0",
			buildEvent("another-signed-in-user"),
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

		await assert.rejects(applyUpdate("v1.5.0", buildEvent(USER)), {
			statusCode: 409,
		});
	});

	it("returns 422 when the target is not the checked version", async () => {
		writeState(okState);

		await assert.rejects(applyUpdate("v9.9.9", buildEvent(USER)), {
			statusCode: 422,
		});
	});

	it("returns 422 when no check has ever succeeded", async () => {
		await assert.rejects(applyUpdate("v1.5.0", buildEvent(USER)), {
			statusCode: 422,
		});
	});

	it("returns 202 with a run block carrying a fresh runId", async () => {
		writeState(okState);

		const result = (await applyUpdate("v1.5.0", buildEvent(USER))) as {
			statusCode: number;
			body: { run: { runId: string; targetVersion: string; outcome: null } };
		};

		assert.equal(result.statusCode, 202);
		assert.equal(result.body.run.targetVersion, "v1.5.0");
		assert.equal(result.body.run.outcome, null);
		assert.ok(result.body.run.runId.length > 0);
	});

	it("writes request.json with exactly the five seam fields and nothing else", async () => {
		writeState(okState);

		await applyUpdate("v1.5.0", buildEvent(USER));

		const request = JSON.parse(
			readFileSync(join(controlDir, "request.json"), "utf8"),
		);

		assert.deepEqual(Object.keys(request).sort(), [
			"expiresAt",
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

	it("gives the request an expiry after its requestedAt (#587)", async () => {
		writeState(okState);

		await applyUpdate("v1.5.0", buildEvent(USER));

		const request = JSON.parse(
			readFileSync(join(controlDir, "request.json"), "utf8"),
		);

		assert.ok(Date.parse(request.expiresAt) > Date.parse(request.requestedAt));
	});
});

describe("POST /system/update/check", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		delete process.env.REMIT_UPDATE_MANIFEST_URL;

		const result = await requestCheck(buildEvent(USER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 401 without writing check-request.json when the caller is not authenticated", async () => {
		writeState(okState);

		const result = await requestCheck(buildEvent());

		assert.ok(hasStatus(result, 401));
		assert.throws(() =>
			readFileSync(join(controlDir, "check-request.json"), "utf8"),
		);
	});

	it("returns 202 and writes check-request.json with the caller's identity and an expiry", async () => {
		writeState(okState);

		const result = (await requestCheck(
			buildEvent("another-signed-in-user"),
		)) as { statusCode: number };

		assert.equal(result.statusCode, 202);
		const request = JSON.parse(
			readFileSync(join(controlDir, "check-request.json"), "utf8"),
		);
		assert.equal(request.requestedBy, "another-signed-in-user");
		assert.ok(Date.parse(request.expiresAt) > Date.parse(request.requestedAt));
	});

	it("returns the check block moved to pending, keeping the rest of the state", async () => {
		writeState(okState);

		const result = (await requestCheck(buildEvent(USER))) as {
			statusCode: number;
			body: {
				currentVersion: string;
				check: Record<string, unknown>;
				run: unknown;
			};
		};

		assert.equal(result.statusCode, 202);
		assert.equal(result.body.currentVersion, "v1.4.1");
		assert.equal(result.body.check.status, "pending");
		assert.equal(result.body.check.latestVersion, "v1.5.0");
		assert.equal(result.body.check.lastCheckedAt, "2026-07-20T08:00:00Z");
		assert.equal(result.body.run, null);
	});

	it("returns pending with only a status when no check has ever run", async () => {
		const result = (await requestCheck(buildEvent(USER))) as {
			body: { check: Record<string, unknown> };
		};

		assert.deepEqual(result.body.check, { status: "pending" });
	});

	it("returns 409 when a check is already pending", async () => {
		writeState(okState);
		writeCheckRequestFile({
			requestedAt: "2026-07-20T08:00:00Z",
			requestedBy: USER,
			expiresAt: "2099-01-01T00:00:00Z",
		});

		await assert.rejects(requestCheck(buildEvent(USER)), {
			statusCode: 409,
		});
	});

	it("allows a fresh request once the pending one has expired", async () => {
		writeState(okState);
		writeCheckRequestFile({
			requestedAt: "2020-01-01T00:00:00Z",
			requestedBy: USER,
			expiresAt: "2020-01-01T00:15:00Z",
		});

		const result = (await requestCheck(buildEvent(USER))) as {
			statusCode: number;
		};

		assert.equal(result.statusCode, 202);
		const request = JSON.parse(
			readFileSync(join(controlDir, "check-request.json"), "utf8"),
		);
		assert.ok(Date.parse(request.expiresAt) > Date.now());
	});
});

describe("GET /system/update — a pending check", () => {
	it("reports the check as pending while the request is unexpired", async () => {
		writeState(okState);
		writeCheckRequestFile({
			requestedAt: new Date().toISOString(),
			requestedBy: USER,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});

		const result = (await getUpdate(buildEvent(USER))) as {
			check: Record<string, unknown>;
		};

		assert.equal(result.check.status, "pending");
		// The last known answer is carried alongside "checking now" (#599).
		assert.equal(result.check.latestVersion, "v1.5.0");
		assert.equal(result.check.lastCheckedAt, "2026-07-20T08:00:00Z");
	});

	it("never claims pending forever: an expired, unanswered request reports failed (#587, #599)", async () => {
		writeState(okState);
		writeCheckRequestFile({
			requestedAt: "2020-01-01T00:00:00Z",
			requestedBy: USER,
			expiresAt: "2020-01-01T00:15:00Z",
		});

		const result = (await getUpdate(buildEvent(USER))) as {
			check: { status: string; error?: string };
		};

		assert.equal(result.check.status, "failed");
		assert.match(result.check.error ?? "", /did not answer/);
	});

	it("stops reporting pending once the updater has consumed the request", async () => {
		writeState(okState);
		// The updater deletes check-request.json once it has answered; a stale
		// state.json check block from before the request is what the caller
		// would still see if the seam file were the only source of truth.
		writeState({
			...okState,
			check: { ...okState.check, updateAvailable: false },
		});

		const result = (await getUpdate(buildEvent(USER))) as {
			check: { status: string };
		};

		assert.equal(result.check.status, "ok");
	});
});
