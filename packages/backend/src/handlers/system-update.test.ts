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
import { createInstanceOwnerStore } from "@remit/auth-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import Database from "better-sqlite3";
import type { Context } from "openapi-backend";
import { SystemOperations } from "./system-update.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	".tmp",
	"system-update",
);

const readMigrationSql = (relativePath: string): string =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const authMigrationSql = readMigrationSql(
	"../../../../deploy/vps/migrations-sqlite/auth/0000_rainy_iron_monger.sql",
);
const metaMigrationSql = readMigrationSql(
	"../../../../deploy/vps/migrations-sqlite/meta/0000_demonic_lilith.sql",
);

const OWNER = "the-owner";
const MANIFEST_URL = "https://updates.example.com/stable.json";

let dbPath: string;
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

before(async () => {
	mkdirSync(tmpRoot, { recursive: true });
	dbPath = join(mkdtempSync(join(tmpRoot, "db-")), "app.db");
	const sqlite = new Database(dbPath);
	for (const sql of [authMigrationSql, metaMigrationSql]) {
		for (const statement of sql.split("--> statement-breakpoint")) {
			sqlite.exec(statement);
		}
	}
	sqlite
		.prepare(
			"INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
		)
		.run(OWNER, OWNER, "owner@example.com", 1000, 1000);
	sqlite.close();
	process.env.DATA_BACKEND = "sqlite";
	process.env.SQLITE_DB_PATH = dbPath;
	const store = await createInstanceOwnerStore({
		provider: "sqlite",
		connectionString: dbPath,
	});
	await store.claimIfUnclaimed(OWNER);
	await store.close();
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

const getUpdate = (event: APIGatewayProxyEvent) =>
	getSystemUpdate({} as unknown as Context, event);

const applyUpdate = (targetVersion: string, event: APIGatewayProxyEvent) =>
	applySystemUpdate(postContext(targetVersion), event);

const hasStatus = (value: unknown, code: number): boolean =>
	typeof value === "object" &&
	value !== null &&
	(value as { statusCode?: number }).statusCode === code;

describe("GET /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		delete process.env.REMIT_UPDATE_MANIFEST_URL;

		const result = await getUpdate(buildEvent(OWNER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 403 for a non-owner", async () => {
		const result = await getUpdate(buildEvent("someone-else"));

		assert.ok(hasStatus(result, 403));
	});

	it("returns 200 with the state file verbatim", async () => {
		writeState(okState);

		const result = await getUpdate(buildEvent(OWNER));

		assert.deepEqual(result, okState);
	});

	it("returns a disabled, empty resource when no state file exists", async () => {
		const result = await getUpdate(buildEvent(OWNER));

		assert.deepEqual(result, {
			currentVersion: "v1.4.1",
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

		const result = (await getUpdate(buildEvent(OWNER))) as {
			check: { status: string };
			run: unknown;
		};

		assert.equal(result.check.status, "failed");
		assert.deepEqual(result.run, run);
	});
});

describe("POST /system/update", () => {
	it("returns 404 when no manifest URL is configured", async () => {
		delete process.env.REMIT_UPDATE_MANIFEST_URL;

		const result = await applyUpdate("v1.5.0", buildEvent(OWNER));

		assert.ok(hasStatus(result, 404));
	});

	it("returns 403 for a non-owner", async () => {
		writeState(okState);

		const result = await applyUpdate("v1.5.0", buildEvent("someone-else"));

		assert.ok(hasStatus(result, 403));
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

		await assert.rejects(applyUpdate("v1.5.0", buildEvent(OWNER)), {
			statusCode: 409,
		});
	});

	it("returns 422 when the target is not the checked version", async () => {
		writeState(okState);

		await assert.rejects(applyUpdate("v9.9.9", buildEvent(OWNER)), {
			statusCode: 422,
		});
	});

	it("returns 422 when no check has ever succeeded", async () => {
		await assert.rejects(applyUpdate("v1.5.0", buildEvent(OWNER)), {
			statusCode: 422,
		});
	});

	it("returns 202 with a run block carrying a fresh runId", async () => {
		writeState(okState);

		const result = (await applyUpdate("v1.5.0", buildEvent(OWNER))) as {
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

		await applyUpdate("v1.5.0", buildEvent(OWNER));

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
		assert.equal(request.requestedBy, OWNER);
		for (const forbidden of ["registry", "image", "digest"]) {
			assert.ok(!(forbidden in request));
		}
	});
});
