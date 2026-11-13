import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { SqliteValue } from "@remit/drizzle-service/sqlite";
import {
	migrateSqlite,
	openSqlite,
	type SqliteHandle,
} from "@remit/drizzle-service/sqlite";
import { type Auth, CLIENT_IP_HEADER, createAuth } from "./auth.js";
import { openIdentityStore } from "./identity-store.js";
import {
	createPeopleDirectory,
	type PeopleAdmin,
	resetIdentifierOf,
	type StepUpAction,
} from "./people.js";

const ORIGIN = "http://localhost:3000";
const MIGRATIONS = resolve(
	import.meta.dirname,
	"../../../deploy/vps/migrations-sqlite",
);
const OPERATOR = "operator@remit.test";
const PASSWORD = "correct horse battery staple";
const PEER = "198.51.100.23";

let dir: string;
let filename: string;
let file: SqliteHandle;
let auth: Auth;
let people: PeopleAdmin;
let operatorId: string;

const post = (path: string, body: unknown, headers = {}) =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: ORIGIN,
				...headers,
			},
			body: JSON.stringify(body),
		}),
	);

const tokenStatus = async (cookie: string): Promise<number> =>
	(
		await auth.handler(
			new Request(`${ORIGIN}/api/auth/token`, { headers: { cookie } }),
		)
	).status;

const cookiesOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");

// Each group signs in from its own address: the sign-in limit is five a minute
// per address, and the groups together sign in more often than that.
const signInFrom =
	(clientIp: string) =>
	(email: string, password = PASSWORD) =>
		post(
			"/sign-in/email",
			{ email, password },
			{ [CLIENT_IP_HEADER]: clientIp },
		);

const signUp = async (email: string): Promise<string> => {
	const response = await post("/sign-up/email", {
		email,
		password: PASSWORD,
		name: email,
	});
	assert.equal(response.status, 200);
	return ((await response.json()) as { user: { id: string } }).user.id;
};

const rows = (statement: string, ...params: SqliteValue[]): unknown[] =>
	file.sqlite.prepare(statement).all(...params);

const run = (statement: string, ...params: SqliteValue[]): void => {
	file.sqlite.prepare(statement).run(...params);
};

const stepUp = async (
	targetId: string,
	action: StepUpAction,
): Promise<string> => {
	const granted = await people.createStepUp({
		callerId: operatorId,
		clientIp: PEER,
		targetId,
		action,
		password: PASSWORD,
	});
	assert.ok(granted.ok, JSON.stringify(granted));
	return granted.value.stepUpToken;
};

const codeOf = async (response: Response): Promise<string | undefined> =>
	((await response.json()) as { code?: string }).code;

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "remit-people-"));
	filename = join(dir, "app.db");
	file = openSqlite({
		filename,
		mode: "create",
	});
	for (const set of ["app", "mcp"]) {
		migrateSqlite(file, {
			migrationsFolder: join(MIGRATIONS, set),
			migrationsTable: `__drizzle_migrations_${set}`,
		});
	}

	const store = await openIdentityStore(filename);
	auth = await createAuth(
		{
			connectionString: filename,
			secret: "people-test-secret-value-of-32-chars-min",
			baseURL: ORIGIN,
			selfSignUpEnabled: true,
			signInEnabled: true,
		},
		store,
	);
	people = await createPeopleDirectory({
		auth,
		store,
		baseURL: ORIGIN,
	});
	operatorId = await signUp(OPERATOR);
});

after(() => {
	people.close();
	file.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("a disabled account", () => {
	const signIn = signInFrom("198.51.100.31");
	const EMAIL = "disabled@remit.test";
	let userId: string;

	before(async () => {
		userId = await signUp(EMAIL);
		const disabled = await people.updatePerson({
			callerId: operatorId,
			clientIp: PEER,
			targetId: userId,
			status: "Disabled",
			stepUpToken: await stepUp(userId, "Disable"),
		});
		assert.ok(disabled.ok);
		assert.equal(disabled.value.status, "Disabled");
	});

	it("is refused after a right password, with a record, and answers 401 to a wrong one", async () => {
		const right = await signIn(EMAIL);
		assert.equal(right.status, 403);
		assert.equal(await codeOf(right), "ACCOUNT_DISABLED");
		assert.equal(right.headers.getSetCookie().length, 0);
		assert.ok(
			rows(
				"SELECT 1 FROM identity_audit_event WHERE action = 'SignInRefusedDisabled' AND outcome = 'RefusedDisabled' AND target = ?",
				userId,
			).length > 0,
		);

		assert.equal((await signIn(EMAIL, "not the password")).status, 401);
	});

	it("loses a session that raced the disable, at its next token mint", async () => {
		assert.ok((await people.enableByEmail(EMAIL)).ok);
		const signedIn = await signIn(EMAIL);
		assert.equal(signedIn.status, 200);
		const cookie = cookiesOf(signedIn);
		run("UPDATE auth_user SET disabled = 1 WHERE id = ?", userId);

		const minted = await auth.handler(
			new Request(`${ORIGIN}/api/auth/token`, { headers: { cookie } }),
		);
		assert.equal(minted.status, 403);
		assert.equal(await codeOf(minted), "ACCOUNT_DISABLED");
		assert.deepEqual(
			rows("SELECT id FROM auth_session WHERE user_id = ?", userId),
			[],
		);
	});

	it("signs in again once enabled", async () => {
		assert.ok((await people.enableByEmail(EMAIL)).ok);
		assert.equal((await signIn(EMAIL)).status, 200);
	});
});

describe("a password reset link", () => {
	const signIn = signInFrom("198.51.100.32");
	const EMAIL = "reset@remit.test";
	const NEW_PASSWORD = "a different long passphrase";
	let userId: string;
	let token: string;

	const tokenOf = (resetUrl: string): string => {
		const found = resetUrl.split("/").at(-1);
		assert.ok(found);
		return found;
	};

	const redeem = (resetToken: string, newPassword = NEW_PASSWORD) =>
		post(
			"/reset-password",
			{ token: resetToken, newPassword },
			{ [CLIENT_IP_HEADER]: PEER },
		);

	before(async () => {
		userId = await signUp(EMAIL);
		const issued = await people.createPasswordReset({
			callerId: operatorId,
			clientIp: PEER,
			targetId: userId,
			stepUpToken: await stepUp(userId, "ResetPassword"),
		});
		assert.ok(issued.ok);
		assert.equal(
			issued.value.resetUrl,
			`${ORIGIN}/reset-password/${tokenOf(issued.value.resetUrl)}`,
		);
		token = tokenOf(issued.value.resetUrl);
	});

	it("is stored only as a digest", () => {
		const stored = JSON.stringify(rows("SELECT * FROM auth_verification"));
		assert.ok(!stored.includes(token));
		assert.equal(
			rows(
				"SELECT 1 FROM auth_verification WHERE identifier = ? AND value = ?",
				resetIdentifierOf(token),
				userId,
			).length,
			1,
		);
	});

	it("stops the old password and every session at once", async () => {
		assert.equal((await signIn(EMAIL)).status, 401);
		const listed = await people.listPeople({
			callerId: operatorId,
			clientIp: PEER,
		});
		assert.ok(listed.ok);
		assert.equal(
			listed.value.find((person) => person.userId === userId)?.sessionCount,
			0,
		);
	});

	it("works once, and a second redeem is refused with a record carrying the client address", async () => {
		assert.equal((await redeem(token)).status, 200);
		assert.equal((await signIn(EMAIL, NEW_PASSWORD)).status, 200);

		const again = await redeem(token, "yet another long passphrase");
		assert.equal(again.status, 400);
		assert.deepEqual(
			rows(
				"SELECT actor, target, client_ip AS clientIp FROM identity_audit_event WHERE action = 'PasswordResetRefused'",
			),
			[{ actor: "unknown", target: "unknown", clientIp: PEER }],
		);
		assert.equal(
			rows(
				"SELECT 1 FROM identity_audit_event WHERE action = 'PasswordResetRedeemed' AND target = ? AND client_ip = ?",
				userId,
				PEER,
			).length,
			1,
		);
	});

	it("is refused past its expiry", async () => {
		const issued = await people.resetByEmail(EMAIL);
		assert.ok(issued.ok);
		run(
			"UPDATE auth_verification SET expires_at = ? WHERE value = ?",
			Math.floor(Date.now() / 1000) - 60,
			userId,
		);
		assert.equal((await redeem(tokenOf(issued.value.resetUrl))).status, 400);
	});

	it("dies when a newer one is issued, and the newer one survives", async () => {
		const older = await people.resetByEmail(EMAIL);
		const newer = await people.resetByEmail(EMAIL);
		assert.ok(older.ok && newer.ok);
		const newerToken = tokenOf(newer.value.resetUrl);
		assert.deepEqual(
			rows("SELECT identifier FROM auth_verification WHERE value = ?", userId),
			[{ identifier: resetIdentifierOf(newerToken) }],
		);
		assert.equal((await redeem(tokenOf(older.value.resetUrl))).status, 400);
		assert.equal((await redeem(newerToken)).status, 200);
	});
});
