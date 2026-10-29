import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Auth, createAuth } from "@remit/auth-service";
import { auth_session, auth_user } from "@remit/auth-service/schema";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { noopLogger } from "@remit/logger";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { buildRelationalDeletionCapabilities } from "./compose-relational.js";

const ORIGIN = "https://reader.remit.test";
const PASSWORD = "correct horse battery staple";

const APP_MIGRATIONS = fileURLToPath(
	new URL("../../../deploy/vps/migrations-sqlite/app", import.meta.url),
);

interface SignedUp {
	userId: string;
	cookie: string;
}

const signUp = async (auth: Auth, email: string): Promise<SignedUp> => {
	const response = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name: email },
		asResponse: true,
	});
	assert.equal(response.status, 200);
	const { user } = (await response.json()) as { user: { id: string } };
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	return { userId: user.id, cookie };
};

const tokenStatus = async (auth: Auth, cookie: string): Promise<number> =>
	(
		await auth.handler(
			new Request(`${ORIGIN}/api/auth/token`, { headers: { cookie } }),
		)
	).status;

describe("relational deletion capabilities — login user erase", () => {
	let filename: string;
	let auth: Auth;
	let erased: SignedUp;
	let kept: SignedUp;

	const rowsOf = (): {
		users: string[];
		sessionUsers: string[];
	} => {
		const sqlite = new Database(filename, { readonly: true });
		const db = drizzle(sqlite);
		const users = db
			.select({ id: auth_user.id })
			.from(auth_user)
			.all()
			.map((row) => row.id);
		const sessionUsers = db
			.select({ userId: auth_session.userId })
			.from(auth_session)
			.all()
			.map((row) => row.userId);
		sqlite.close();
		return { users, sessionUsers };
	};

	before(async () => {
		const dir = await mkdtemp(join(tmpdir(), "remit-relational-auth-"));
		filename = join(dir, "app.db");
		process.env.SQLITE_APP_DB_PATH = filename;
		process.env.SQLITE_MAIL_DB_PATH = join(dir, "mail.db");
		process.env.SQLITE_SEARCH_DB_PATH = join(dir, "search.db");

		const migrating = new Database(filename);
		migrating.pragma("journal_mode = WAL");
		migrate(drizzle(migrating), {
			migrationsFolder: APP_MIGRATIONS,
			migrationsTable: "__drizzle_migrations_app",
		});
		migrating.close();

		auth = await createAuth({
			connectionString: filename,
			secret: "relational-auth-secret-0123456789abcdef",
			baseURL: ORIGIN,
			selfSignUpEnabled: true,
		});
		erased = await signUp(auth, "erased@remit.test");
		kept = await signUp(auth, "kept@remit.test");
	});

	it("deletes the user and its sessions, and refuses the old session cookie", async () => {
		assert.equal(await tokenStatus(auth, erased.cookie), 200);

		await buildRelationalDeletionCapabilities().signOut(
			deriveAccountConfigId(erased.userId),
			noopLogger,
		);

		const { users, sessionUsers } = rowsOf();
		assert.deepEqual(users, [kept.userId]);
		assert.deepEqual(sessionUsers, [kept.userId]);
		assert.equal(await tokenStatus(auth, erased.cookie), 401);
		assert.equal(await tokenStatus(auth, kept.cookie), 200);
	});
});
