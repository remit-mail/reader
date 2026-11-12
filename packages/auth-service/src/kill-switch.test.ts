import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { migrateSqlite, openSqlite } from "@remit/drizzle-service/sqlite";
import { type Auth, createAuth } from "./auth.js";
import { openIdentityStore } from "./identity-store.js";
import { createPeopleDirectory } from "./people.js";

const ORIGIN = "http://localhost:3000";
const MIGRATIONS = resolve(
	import.meta.dirname,
	"../../../deploy/vps/migrations-sqlite",
);
const EMAIL = "owner@remit.test";
const PASSWORD = "correct horse battery staple";

let dir: string;
let filename: string;

const build = async (signInEnabled: boolean): Promise<Auth> =>
	createAuth(
		{
			connectionString: filename,
			secret: "kill-switch-test-secret-value-32chars-min",
			baseURL: ORIGIN,
			selfSignUpEnabled: true,
			signInEnabled,
		},
		await openIdentityStore(filename),
	);

const boot = async (auth: Auth, signInEnabled: boolean): Promise<void> => {
	const people = await createPeopleDirectory({
		auth,
		store: await openIdentityStore(filename),
		baseURL: ORIGIN,
	});
	people.applySignInSwitch(signInEnabled);
	people.close();
};

const post = (auth: Auth, path: string, body: unknown, cookie = "") =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN, cookie },
			body: JSON.stringify(body),
		}),
	);

const get = (auth: Auth, path: string, cookie = "") =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, { headers: { cookie } }),
	);

const cookiesOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");

const rows = (sql: string): unknown[] => {
	const handle = openSqlite({
		filename,
		mode: "readonly",
		synchronous: "NORMAL",
		schema: {},
	});
	const found = handle.sqlite.prepare(sql).all();
	handle.close();
	return found;
};

before(() => {
	dir = mkdtempSync(join(tmpdir(), "remit-kill-switch-"));
	filename = join(dir, "app.db");
	const migrating = openSqlite({
		filename,
		mode: "create",
		synchronous: "NORMAL",
		schema: {},
	});
	for (const set of ["app", "mcp"]) {
		migrateSqlite(migrating, {
			migrationsFolder: join(MIGRATIONS, set),
			migrationsTable: `__drizzle_migrations_${set}`,
		});
	}
	migrating.close();
});

after(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("the sign-in kill switch", () => {
	let cookie: string;

	it("refuses sign-in, sign-up, token and session reads while it is off, and keeps the JWKS up", async () => {
		const on = await build(true);
		const signedUp = await post(on, "/sign-up/email", {
			email: EMAIL,
			password: PASSWORD,
			name: "Owner",
		});
		assert.equal(signedUp.status, 200);
		cookie = cookiesOf(signedUp);
		const userId = (rows("SELECT id FROM auth_user")[0] as { id: string }).id;
		const handle = openSqlite({
			filename,
			mode: "open",
			synchronous: "NORMAL",
			schema: {},
		});
		handle.sqlite
			.prepare(
				"INSERT INTO mcp_oauth_client (id, client_id, redirect_uris) VALUES ('client-row', 'client-1', '[]')",
			)
			.run();
		handle.sqlite
			.prepare(
				"INSERT INTO mcp_oauth_consent (id, client_id, user_id, scopes) VALUES ('consent-1', 'client-1', ?, '[]')",
			)
			.run(userId);
		handle.close();

		const off = await build(false);
		const refusals = [
			await post(off, "/sign-in/email", { email: EMAIL, password: PASSWORD }),
			await post(off, "/sign-up/email", {
				email: "new@remit.test",
				password: PASSWORD,
				name: "New",
			}),
			await get(off, "/token", cookie),
			await get(off, "/get-session", cookie),
		];
		for (const response of refusals) {
			assert.equal(response.status, 403);
			assert.equal(
				((await response.json()) as { code: string }).code,
				"SIGN_IN_DISABLED",
			);
		}
		assert.equal((await get(off, "/jwks")).status, 200);
	});

	it("revokes every session and MCP consent at boot, and records it once across two boots", async () => {
		const off = await build(false);
		await boot(off, false);
		await boot(off, false);

		assert.deepEqual(rows("SELECT id FROM auth_session"), []);
		assert.deepEqual(rows("SELECT id FROM mcp_oauth_consent"), []);
		assert.deepEqual(
			rows(
				"SELECT actor, target, action, client_ip AS clientIp FROM identity_audit_event WHERE action LIKE 'KillSwitch%'",
			),
			[
				{
					actor: "env",
					target: "all",
					action: "KillSwitchOn",
					clientIp: "host",
				},
			],
		);
	});

	it("lets a user sign in again once it is back on, with the old session still gone", async () => {
		const on = await build(true);
		await boot(on, true);

		assert.equal((await get(on, "/token", cookie)).status, 401);
		const signedIn = await post(on, "/sign-in/email", {
			email: EMAIL,
			password: PASSWORD,
		});
		assert.equal(signedIn.status, 200);
		assert.equal((await get(on, "/token", cookiesOf(signedIn))).status, 200);
		assert.deepEqual(
			rows(
				"SELECT action FROM identity_audit_event WHERE action LIKE 'KillSwitch%' ORDER BY occurred_at",
			),
			[{ action: "KillSwitchOn" }, { action: "KillSwitchOff" }],
		);
	});
});
