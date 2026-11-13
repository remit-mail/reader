import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Auth, createAuth, openIdentityStore } from "@remit/auth-service";
import { auth_session, auth_user } from "@remit/auth-service/schema";
import { mcp_device_code } from "@remit/drizzle-service/schema-sets/mcp";
import { migrateSqlite, openSqlite } from "@remit/drizzle-service/sqlite";
import { noopLogger } from "@remit/logger";
import { buildRelationalDeletionCapabilities } from "./compose-relational.js";

const ORIGIN = "https://reader.remit.test";
const PASSWORD = "correct horse battery staple";

const MIGRATIONS = new URL(
	"../../../deploy/vps/migrations-sqlite/",
	import.meta.url,
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
		deviceCodeUsers: (string | null)[];
	} => {
		const { db, close } = openSqlite({
			filename,
			mode: "readonly",
		});
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
		const deviceCodeUsers = db
			.select({ userId: mcp_device_code.userId })
			.from(mcp_device_code)
			.all()
			.map((row) => row.userId);
		close();
		return { users, sessionUsers, deviceCodeUsers };
	};

	before(async () => {
		const dir = await mkdtemp(join(tmpdir(), "remit-relational-auth-"));
		filename = join(dir, "app.db");
		process.env.SQLITE_APP_DB_PATH = filename;
		process.env.SQLITE_MAIL_DB_PATH = join(dir, "mail.db");
		process.env.SQLITE_SEARCH_DB_PATH = join(dir, "search.db");

		const migrating = openSqlite({
			filename,
			mode: "create",
		});
		for (const set of ["app", "mcp"]) {
			migrateSqlite(migrating, {
				migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS)),
				migrationsTable: `__drizzle_migrations_${set}`,
			});
		}
		migrating.close();

		auth = await createAuth(
			{
				connectionString: filename,
				secret: "relational-auth-secret-0123456789abcdef",
				baseURL: ORIGIN,
				selfSignUpEnabled: true,
				signInEnabled: true,
			},
			await openIdentityStore(filename),
		);
		erased = await signUp(auth, "erased@remit.test");
		kept = await signUp(auth, "kept@remit.test");

		const seeding = openSqlite({
			filename,
			mode: "open",
		});
		seeding.db
			.insert(mcp_device_code)
			.values(
				[erased, kept].map(({ userId }) => ({
					id: userId,
					deviceCode: `device-${userId}`,
					userCode: `user-${userId}`,
					userId,
					expiresAt: new Date(Date.now() + 600_000),
					status: "approved",
				})),
			)
			.run();
		seeding.close();
	});

	it("deletes the user, its sessions and device codes, and refuses the old session cookie", async () => {
		assert.equal(await tokenStatus(auth, erased.cookie), 200);

		await buildRelationalDeletionCapabilities().signOut(
			erased.userId,
			noopLogger,
		);

		const { users, sessionUsers, deviceCodeUsers } = rowsOf();
		assert.deepEqual(users, [kept.userId]);
		assert.deepEqual(sessionUsers, [kept.userId]);
		assert.deepEqual(deviceCodeUsers, [kept.userId]);
		assert.equal(await tokenStatus(auth, erased.cookie), 401);
		assert.equal(await tokenStatus(auth, kept.cookie), 200);
	});
});
