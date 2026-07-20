import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createAuth } from "./auth.js";
import {
	_setInstanceOwnerStoreForTest,
	createInstanceOwnerStore,
	type InstanceOwnerStore,
	isInstanceOwner,
} from "./instance-owner.js";
import * as authSchemaSqlite from "./schema/auth-schema-sqlite.js";
import * as metaSchemaSqlite from "./schema/meta-schema-sqlite.js";

const combinedSchema = { ...authSchemaSqlite, ...metaSchemaSqlite };

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	".tmp",
	"instance-owner",
);

after(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

const makeDbPath = (): string => {
	mkdirSync(tmpRoot, { recursive: true });
	return join(mkdtempSync(join(tmpRoot, "db-")), "app.db");
};

/**
 * Provision a fresh sqlite file with the auth + meta tables so a test can
 * exercise the real dialect a self-host deployment runs — the pushed shape
 * derives from the same drizzle table objects the committed migrations do
 * (see the drift guard in drizzle-service).
 */
const provisionSchema = async (dbPath: string): Promise<void> => {
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema: combinedSchema });
	const write = process.stdout.write.bind(process.stdout);
	process.stdout.write = (() => true) as typeof process.stdout.write;
	let statementsToExecute: string[];
	try {
		({ statementsToExecute } = await pushSQLiteSchema(
			combinedSchema,
			db as unknown as Parameters<typeof pushSQLiteSchema>[1],
		));
	} finally {
		process.stdout.write = write;
	}
	for (const statement of statementsToExecute) sqlite.exec(statement);
	sqlite.close();
};

const insertUser = (dbPath: string, id: string, email: string): void => {
	const sqlite = new Database(dbPath);
	sqlite
		.prepare(
			"INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
		)
		.run(id, email, email, Date.now(), Date.now());
	sqlite.close();
};

const userIdByEmail = (dbPath: string, email: string): string => {
	const sqlite = new Database(dbPath);
	const row = sqlite
		.prepare("SELECT id FROM auth_user WHERE email = ?")
		.get(email) as { id: string } | undefined;
	sqlite.close();
	if (!row) throw new Error(`no such user: ${email}`);
	return row.id;
};

describe("createInstanceOwnerStore (sqlite)", () => {
	it("claims ownership for the first claimant and ignores later claims", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});

		await store.claimIfUnclaimed("user-1");
		await store.claimIfUnclaimed("user-2");

		assert.equal(await store.isOwner("user-1"), true);
		assert.equal(await store.isOwner("user-2"), false);
		await store.close();
	});

	it("produces exactly one owner under concurrent first claims", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});

		await Promise.all([
			store.claimIfUnclaimed("user-a"),
			store.claimIfUnclaimed("user-b"),
		]);

		const aIsOwner = await store.isOwner("user-a");
		const bIsOwner = await store.isOwner("user-b");
		assert.notEqual(aIsOwner, bIsOwner);
		await store.close();
	});

	it("REMIT_OWNER_EMAIL resolves to a user and ignores the stored claim", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		insertUser(dbPath, "user-2", "second@example.com");
		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});
		await store.claimIfUnclaimed("user-1");

		assert.equal(await store.isOwner("user-1", "second@example.com"), false);
		assert.equal(await store.isOwner("user-2", "second@example.com"), true);
		await store.close();
	});

	it("REMIT_OWNER_EMAIL naming no account makes every caller a non-owner", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});
		await store.claimIfUnclaimed("user-1");

		assert.equal(await store.isOwner("user-1", "nobody@example.com"), false);
		await store.close();
	});
});

describe("isInstanceOwner", () => {
	afterEach(() => {
		_setInstanceOwnerStoreForTest(null);
		delete process.env.REMIT_OWNER_EMAIL;
	});

	it("passes REMIT_OWNER_EMAIL through to the store when set", async () => {
		const calls: Array<string | undefined> = [];
		const stub: InstanceOwnerStore = {
			claimIfUnclaimed: async () => {},
			isOwner: async (_userId, ownerEmail) => {
				calls.push(ownerEmail);
				return ownerEmail === "owner@example.com";
			},
			close: async () => {},
		};
		_setInstanceOwnerStoreForTest(stub);
		process.env.REMIT_OWNER_EMAIL = "owner@example.com";

		assert.equal(await isInstanceOwner("user-1"), true);
		assert.deepEqual(calls, ["owner@example.com"]);
	});

	it("omits ownerEmail when REMIT_OWNER_EMAIL is unset", async () => {
		let received: string | undefined = "unset";
		const stub: InstanceOwnerStore = {
			claimIfUnclaimed: async () => {},
			isOwner: async (_userId, ownerEmail) => {
				received = ownerEmail;
				return false;
			},
			close: async () => {},
		};
		_setInstanceOwnerStoreForTest(stub);

		await isInstanceOwner("user-1");

		assert.equal(received, undefined);
	});
});

describe("createAuth claims ownership on registration (RFC 037 D8)", () => {
	const baseConfig = {
		secret: "instance-owner-test-secret-value-32chars-minimum",
		baseURL: "http://localhost:3000",
		selfSignUpEnabled: true,
	};

	const signUp = (
		auth: Awaited<ReturnType<typeof createAuth>>,
		email: string,
	) =>
		auth.handler(
			new Request("http://localhost:3000/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email,
					password: "a-sufficiently-long-password",
					name: email,
				}),
			}),
		);

	it("the first successful registration claims ownership; the second does not", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		const auth = await createAuth({
			...baseConfig,
			provider: "sqlite",
			connectionString: dbPath,
		});

		const first = await signUp(auth, "first@example.com");
		assert.equal(first.status, 200);
		const second = await signUp(auth, "second@example.com");
		assert.equal(second.status, 200);

		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});
		assert.equal(
			await store.isOwner(userIdByEmail(dbPath, "first@example.com")),
			true,
		);
		assert.equal(
			await store.isOwner(userIdByEmail(dbPath, "second@example.com")),
			false,
		);
		await store.close();
	});

	it("concurrent first registrations produce exactly one owner", async () => {
		const dbPath = makeDbPath();
		await provisionSchema(dbPath);
		const auth = await createAuth({
			...baseConfig,
			provider: "sqlite",
			connectionString: dbPath,
		});

		const [first, second] = await Promise.all([
			signUp(auth, "racer-a@example.com"),
			signUp(auth, "racer-b@example.com"),
		]);
		assert.equal(first.status, 200);
		assert.equal(second.status, 200);

		const store = await createInstanceOwnerStore({
			provider: "sqlite",
			connectionString: dbPath,
		});
		const aIsOwner = await store.isOwner(
			userIdByEmail(dbPath, "racer-a@example.com"),
		);
		const bIsOwner = await store.isOwner(
			userIdByEmail(dbPath, "racer-b@example.com"),
		);
		assert.notEqual(aIsOwner, bIsOwner);
		await store.close();
	});
});
