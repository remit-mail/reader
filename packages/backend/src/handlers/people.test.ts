import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type Auth,
	createAuth,
	createPeopleDirectory,
	openIdentityStore,
	type PeopleAdmin,
} from "@remit/auth-service";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Context } from "openapi-backend";
import type { ApiConfig } from "../config/api-config.js";
import { testApiConfig, testSelfHostAuth } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import { setPeopleDirectory } from "../service/people-directory.js";
import type { HandlerContext } from "../types.js";
import { PeopleOperations } from "./people.js";

const ORIGIN = "https://reader.remit.test";
const PASSWORD = "correct horse battery staple";
const PEER = "198.51.100.41";
const MIGRATIONS = fileURLToPath(
	new URL("../../../../deploy/vps/migrations-sqlite/", import.meta.url),
);

type Action = "SignOut" | "Disable" | "Enable" | "ResetPassword";

let dir: string;
let filename: string;
let auth: Auth;
let people: PeopleAdmin;

const closedConfig: ApiConfig = testApiConfig({
	auth: testSelfHostAuth({ selfSignUp: "Disabled" }),
	corsAllowedOrigins: [ORIGIN],
});

const sql = (statement: string, ...params: unknown[]): unknown[] => {
	const sqlite = new Database(filename);
	const prepared = sqlite.prepare(statement);
	const found = prepared.reader ? prepared.all(...params) : [];
	if (!prepared.reader) prepared.run(...params);
	sqlite.close();
	return found;
};

const signUp = async (email: string): Promise<string> => {
	const response = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name: email },
		asResponse: true,
	});
	assert.equal(response.status, 200);
	return ((await response.json()) as { user: { id: string } }).user.id;
};

const callerOf = (sub: string, config = closedConfig): HandlerContext => ({
	client: {} as RemitClient,
	config,
	identity: {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email: `${sub}@remit.test`,
	},
});

const contextOf = (
	params: Record<string, string>,
	requestBody: unknown,
	origin = ORIGIN,
): Context =>
	({
		request: {
			params,
			requestBody,
			headers: { origin, "x-remit-client-ip": PEER },
		},
	}) as unknown as Context;

interface Refusal {
	statusCode: number;
	body: { code: string };
}

const isRefusal = (value: unknown): value is Refusal =>
	typeof value === "object" &&
	value !== null &&
	"statusCode" in value &&
	"body" in value;

const refusalOf = (value: unknown): [number, string] | undefined =>
	isRefusal(value) ? [value.statusCode, value.body.code] : undefined;

const listPeople = (caller: string, config = closedConfig) =>
	PeopleOperations.PeopleOperations_listPeople(
		contextOf({}, undefined),
		callerOf(caller, config),
	);

const createStepUp = (
	caller: string,
	userId: string,
	action: Action,
	password = PASSWORD,
	config = closedConfig,
) =>
	PeopleOperations.PeopleOperations_createStepUp(
		contextOf({}, { password, action, userId }),
		callerOf(caller, config),
	);

const stepUpToken = async (
	caller: string,
	userId: string,
	action: Action,
): Promise<string> => {
	const granted = await createStepUp(caller, userId, action);
	assert.equal(refusalOf(granted), undefined, JSON.stringify(granted));
	return (granted as { stepUpToken: string }).stepUpToken;
};

const signOut = (
	caller: string,
	userId: string,
	token: string,
	config = closedConfig,
	origin = ORIGIN,
) =>
	PeopleOperations.PeopleOperations_signOutPerson(
		contextOf({ userId }, { stepUpToken: token }, origin),
		callerOf(caller, config),
	);

const update = (
	caller: string,
	userId: string,
	status: "Active" | "Disabled",
	token: string,
	config = closedConfig,
) =>
	PeopleOperations.PeopleOperations_updatePerson(
		contextOf({ userId }, { status, stepUpToken: token }),
		callerOf(caller, config),
	);

const reset = (
	caller: string,
	userId: string,
	token: string,
	config = closedConfig,
) =>
	PeopleOperations.PeopleOperations_createPasswordReset(
		contextOf({ userId }, { stepUpToken: token }),
		callerOf(caller, config),
	);

const auditCount = (where: string, ...params: unknown[]): number =>
	(
		sql(
			`SELECT count(*) AS n FROM identity_audit_event WHERE ${where}`,
			...params,
		)[0] as { n: number }
	).n;

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "remit-people-handlers-"));
	filename = join(dir, "app.db");
	const sqlite = new Database(filename);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	for (const set of ["app", "mcp"]) {
		migrate(drizzle({ client: sqlite }), {
			migrationsFolder: join(MIGRATIONS, set),
			migrationsTable: `__drizzle_migrations_${set}`,
		});
	}
	sqlite.close();

	const store = await openIdentityStore(filename);
	auth = await createAuth(
		{
			connectionString: filename,
			secret: "people-handler-secret-value-32chars-min",
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
	setPeopleDirectory(people);
});

after(() => {
	setPeopleDirectory(null);
	people.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("the People operations", () => {
	let alice: string;
	let bob: string;
	let carol: string;

	before(async () => {
		alice = await signUp("alice@remit.test");
		bob = await signUp("bob@remit.test");
		carol = await signUp("carol@remit.test");
	});

	it("do not exist while self sign-up is open", async () => {
		const open = testApiConfig({
			auth: testSelfHostAuth({ selfSignUp: "Enabled" }),
			corsAllowedOrigins: [ORIGIN],
		});
		const answers = [
			await listPeople(alice, open),
			await createStepUp(alice, bob, "SignOut", PASSWORD, open),
			await signOut(alice, bob, "token", open),
			await update(alice, bob, "Disabled", "token", open),
			await reset(alice, bob, "token", open),
		];
		for (const answer of answers) {
			assert.deepEqual(refusalOf(answer), [404, "not_found"]);
		}
	});

	it("refuse every sensitive operation without a matching, unspent, unexpired step-up", async () => {
		const operations: Array<{
			action: Action;
			act: (caller: string, token: string) => Promise<unknown>;
		}> = [
			{
				action: "SignOut",
				act: (caller, token) => signOut(caller, carol, token),
			},
			{
				action: "Disable",
				act: (caller, token) => update(caller, carol, "Disabled", token),
			},
			{
				action: "ResetPassword",
				act: (caller, token) => reset(caller, carol, token),
			},
		];
		for (const { action, act } of operations) {
			const expired = await stepUpToken(alice, carol, action);
			sql("UPDATE identity_step_up SET expires_at = ?", Date.now() - 1000);
			const spent = await stepUpToken(alice, carol, action);
			assert.equal(refusalOf(await act(alice, spent)), undefined);
			const bobs = await stepUpToken(bob, carol, action);
			const otherAction = await stepUpToken(
				alice,
				carol,
				action === "SignOut" ? "Enable" : "SignOut",
			);
			const otherTarget = await stepUpToken(alice, bob, action);

			for (const [label, caller, token] of [
				["no token", alice, ""],
				["an expired token", alice, expired],
				["a spent token", alice, spent],
				["another caller's token", alice, bobs],
				["a token for another action", alice, otherAction],
				["a token for another person", alice, otherTarget],
			] as const) {
				const answer = await act(caller, token);
				assert.deepEqual(
					refusalOf(answer),
					[403, "step_up_required"],
					`${action} with ${label}`,
				);
				assert.ok(!JSON.stringify(answer).includes("resetUrl"));
			}
			if (action === "Disable") {
				await update(
					alice,
					carol,
					"Active",
					await stepUpToken(alice, carol, "Enable"),
				);
			}
		}
	});

	it("count parallel wrong step-up passwords before checking them", async () => {
		const dave = await signUp("dave@remit.test");
		const answers = await Promise.all(
			Array.from({ length: 10 }, () =>
				createStepUp(dave, alice, "SignOut", "not the password"),
			),
		);
		const codes = answers.map((answer) => refusalOf(answer)?.join(" "));
		assert.equal(
			codes.filter((code) => code === "403 wrong_password").length,
			5,
		);
		assert.equal(
			codes.filter((code) => code === "429 step_up_locked").length,
			5,
		);
		assert.equal(auditCount("actor = ? AND action = 'StepUpFailed'", dave), 5);
	});

	it("refuse a step-up its holder earned before being signed out", async () => {
		const earned = await stepUpToken(bob, carol, "SignOut");
		const signedOut = await signOut(
			alice,
			bob,
			await stepUpToken(alice, bob, "SignOut"),
		);
		assert.equal((signedOut as { sessionCount: number }).sessionCount, 0);

		assert.deepEqual(refusalOf(await signOut(bob, carol, earned)), [
			403,
			"step_up_required",
		]);
	});

	it("refuse to let a caller disable themselves, and record it", async () => {
		const answer = await update(
			alice,
			alice,
			"Disabled",
			await stepUpToken(alice, alice, "Disable"),
		);
		assert.deepEqual(refusalOf(answer), [409, "cannot_disable_self"]);
		assert.equal(auditCount("actor = ? AND outcome = 'RefusedSelf'", alice), 1);
		assert.equal(
			(
				sql("SELECT disabled FROM auth_user WHERE id = ?", alice)[0] as {
					disabled: number;
				}
			).disabled,
			0,
		);
	});

	it("refuse a disabled caller on all five, and the second of two users disabling each other", async () => {
		const bobsDisable = await stepUpToken(bob, alice, "Disable");
		const disabled = await update(
			alice,
			bob,
			"Disabled",
			await stepUpToken(alice, bob, "Disable"),
		);
		assert.equal((disabled as { status: string }).status, "Disabled");

		const answers = [
			await listPeople(bob),
			await createStepUp(bob, alice, "Disable"),
			await signOut(bob, alice, "token"),
			await update(bob, alice, "Disabled", bobsDisable),
			await reset(bob, alice, "token"),
		];
		for (const answer of answers) {
			assert.deepEqual(refusalOf(answer), [403, "caller_disabled"]);
		}
		const listed = (await listPeople(alice)) as {
			people: Array<{ userId: string; status: string }>;
		};
		assert.equal(
			listed.people.find((person) => person.userId === alice)?.status,
			"Active",
		);
	});

	it("revoke a disabled person's calendar feeds and keep everyone else's", async () => {
		const erin = await signUp("erin@remit.test");
		const insertFeed = (userId: string, feedTokenId: string) =>
			sql(
				"INSERT INTO calendar_feed_token (feed_token_id, account_config_id, calendar_id, token_hash, created_at, updated_at) VALUES (?, ?, 'cal', ?, 0, 0)",
				feedTokenId,
				deriveAccountConfigId(userId),
				`hash-${feedTokenId}`,
			);
		insertFeed(erin, "erin-feed");
		insertFeed(carol, "carol-feed");

		await update(
			alice,
			erin,
			"Disabled",
			await stepUpToken(alice, erin, "Disable"),
		);

		assert.deepEqual(
			sql("SELECT feed_token_id AS id FROM calendar_feed_token"),
			[{ id: "carol-feed" }],
		);
	});

	it("sweep audit records older than 90 days on every insert", async () => {
		sql(
			"INSERT INTO identity_audit_event (audit_event_id, occurred_at, actor, target, action, outcome, client_ip) VALUES ('ancient', ?, 'env', 'all', 'KillSwitchOn', 'Succeeded', 'host')",
			Date.now() - 91 * 24 * 60 * 60 * 1000,
		);
		await stepUpToken(alice, carol, "SignOut");
		assert.equal(auditCount("audit_event_id = 'ancient'"), 0);
	});
});
