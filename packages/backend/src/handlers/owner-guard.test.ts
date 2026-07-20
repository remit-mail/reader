import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createInstanceOwnerStore } from "@remit/auth-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import Database from "better-sqlite3";
import { requireInstanceOwner } from "./owner-guard.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	".tmp",
	"owner-guard",
);

const metaMigrationSql = readFileSync(
	fileURLToPath(
		new URL(
			"../../../../deploy/vps/migrations-sqlite/meta/0000_demonic_lilith.sql",
			import.meta.url,
		),
	),
	"utf8",
);

let dbPath: string;

before(() => {
	mkdirSync(tmpRoot, { recursive: true });
	dbPath = join(mkdtempSync(join(tmpRoot, "db-")), "app.db");
	const sqlite = new Database(dbPath);
	for (const statement of metaMigrationSql.split("--> statement-breakpoint")) {
		sqlite.exec(statement);
	}
	sqlite.close();
	process.env.DATA_BACKEND = "sqlite";
	process.env.SQLITE_DB_PATH = dbPath;
});

after(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
	delete process.env.REMIT_OWNER_EMAIL;
});

const buildEvent = (sub?: string): APIGatewayProxyEvent =>
	({
		headers: {},
		requestContext: sub ? { authorizer: { claims: { sub } } } : {},
	}) as unknown as APIGatewayProxyEvent;

describe("requireInstanceOwner", () => {
	it("rejects a request with no authenticated caller", async () => {
		const result = await requireInstanceOwner(buildEvent());

		assert.equal(result?.statusCode, 403);
	});

	it("rejects a caller who has not claimed ownership", async () => {
		const result = await requireInstanceOwner(buildEvent("not-the-owner"));

		assert.equal(result?.statusCode, 403);
	});

	it("lets the instance owner through", async () => {
		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});
		await store.claimIfUnclaimed("the-owner");
		await store.close();

		const result = await requireInstanceOwner(buildEvent("the-owner"));

		assert.equal(result, null);
	});
});
