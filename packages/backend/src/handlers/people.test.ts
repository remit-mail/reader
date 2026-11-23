import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { requestValidators } from "@remit/api-openapi-spec/request-validators";
import {
	type Auth,
	createAuth,
	createPeopleDirectory,
	openIdentityStore,
	type PeopleAdmin,
	type PeopleDirectory,
} from "@remit/auth-service";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { SqliteValue } from "@remit/drizzle-service/sqlite";
import { migrateSqlite, openSqlite } from "@remit/drizzle-service/sqlite";
import type { Context } from "openapi-backend";
import type { ApiConfig } from "../config/api-config.js";
import { testApiConfig, testSelfHostAuth } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
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

const hostedConfig = testApiConfig({ corsAllowedOrigins: [ORIGIN] });

const openApp = () => openSqlite({ filename, mode: "open" });

const rows = (statement: string, ...params: SqliteValue[]): unknown[] => {
	const handle = openApp();
	const found = handle.sqlite.prepare(statement).all(...params);
	handle.close();
	return found;
};

const run = (statement: string, ...params: SqliteValue[]): void => {
	const handle = openApp();
	handle.sqlite.prepare(statement).run(...params);
	handle.close();
};

const signUp = async (email: string): Promise<string> => {
	const response = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name: email },
		asResponse: true,
	});
	assert.equal(response.status, 200);
	return ((await response.json()) as { user: { id: string } }).user.id;
};

const callerOf = (
	sub: string,
	config = closedConfig,
	operator = true,
	directory: PeopleDirectory = people,
): HandlerContext => ({
	client: {} as RemitClient,
	config,
	operator,
	peopleDirectory: directory,
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
	stepUpToken?: string,
): Context =>
	({
		request: {
			params,
			requestBody,
			headers: {
				origin,
				"x-remit-client-ip": PEER,
				...(stepUpToken === undefined
					? {}
					: { "x-remit-step-up": stepUpToken }),
			},
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

const listAudit = (caller: string, operator = true, config = closedConfig) =>
	PeopleOperations.PeopleOperations_listAudit(
		contextOf({}, undefined),
		callerOf(caller, config, operator),
	);

const invite = (caller: string, email: string, operator = true) =>
	PeopleOperations.PeopleOperations_invitePerson(
		contextOf({}, { email }),
		callerOf(caller, closedConfig, operator),
	);

const revokeInvite = (caller: string, email: string, operator = true) =>
	PeopleOperations.PeopleOperations_revokeInvite(
		contextOf({ email }, undefined),
		callerOf(caller, closedConfig, operator),
	);

const resetFactors = (caller: string, userId: string, operator = true) =>
	PeopleOperations.PeopleOperations_resetPersonFactors(
		contextOf({ userId }, undefined),
		callerOf(caller, closedConfig, operator),
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

const signOut = (
	caller: string,
	userId: string,
	token?: string,
	config = closedConfig,
	origin = ORIGIN,
) =>
	PeopleOperations.PeopleOperations_signOutPerson(
		contextOf({ userId }, undefined, origin, token),
		callerOf(caller, config),
	);

const update = (
	caller: string,
	userId: string,
	status: "Active" | "Disabled",
	token?: string,
	config = closedConfig,
) =>
	PeopleOperations.PeopleOperations_updatePerson(
		contextOf({ userId }, { status }, ORIGIN, token),
		callerOf(caller, config),
	);

const reset = (
	caller: string,
	userId: string,
	token?: string,
	config = closedConfig,
) =>
	PeopleOperations.PeopleOperations_createPasswordReset(
		contextOf({ userId }, undefined, ORIGIN, token),
		callerOf(caller, config),
	);

const auditCount = (where: string, ...params: SqliteValue[]): number =>
	(
		rows(
			`SELECT count(*) AS n FROM identity_audit_event WHERE ${where}`,
			...params,
		)[0] as { n: number }
	).n;

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "remit-people-handlers-"));
	filename = join(dir, "app.db");
	const sqlite = openSqlite({
		filename,
		mode: "create",
	});
	for (const set of ["app", "mcp"]) {
		migrateSqlite(sqlite, {
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
});

after(() => {
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
			await listAudit(alice, true, open),
			await createStepUp(alice, bob, "SignOut", PASSWORD, open),
			await signOut(alice, bob, "token", open),
			await update(alice, bob, "Disabled", "token", open),
			await reset(alice, bob, "token", open),
		];
		for (const answer of answers) {
			assert.deepEqual(refusalOf(answer), [404, "not_found"]);
		}
	});

	it("expose each new action only to operators and only where supported", async () => {
		const actions = [
			() => listAudit(alice),
			() => invite(alice, "invitee@remit.test"),
			() => revokeInvite(alice, "invitee@remit.test"),
			() => resetFactors(alice, carol),
		];
		const [audit, ...unsupported] = await Promise.all(
			actions.map((action) => action()),
		);
		assert.ok(
			Array.isArray((audit as { events: unknown[] }).events),
			JSON.stringify(audit),
		);
		for (const answer of unsupported) {
			assert.deepEqual(refusalOf(answer), [404, "not_found"]);
		}
		for (const action of [
			() => listAudit(alice, false),
			() => invite(alice, "invitee@remit.test", false),
			() => revokeInvite(alice, "invitee@remit.test", false),
			() => resetFactors(alice, carol, false),
		]) {
			await assert.rejects(action, /Operator access required/);
		}
	});

	it("let a hosted operator act without a step-up", async () => {
		for (const [operation, body] of [
			["PeopleOperations_signOutPerson", undefined],
			["PeopleOperations_updatePerson", { status: "Disabled" }],
			["PeopleOperations_createPasswordReset", undefined],
		] as const) {
			const validate = requestValidators[operation]?.[0];
			assert.ok(validate);
			assert.equal(
				validate({
					path: { userId: carol },
					header: {},
					...(body === undefined ? {} : { requestBody: body }),
				}),
				true,
				JSON.stringify(validate.errors),
			);
		}
		const caller = callerOf(alice, hostedConfig, true);
		for (const answer of [
			await PeopleOperations.PeopleOperations_signOutPerson(
				contextOf({ userId: carol }, undefined),
				caller,
			),
			await PeopleOperations.PeopleOperations_updatePerson(
				contextOf({ userId: carol }, { status: "Disabled" }),
				caller,
			),
			await PeopleOperations.PeopleOperations_createPasswordReset(
				contextOf({ userId: carol }, undefined),
				caller,
			),
		]) {
			assert.equal(refusalOf(answer), undefined);
			assert.ok(
				(answer && "userId" in answer) || (answer && "resetUrl" in answer),
			);
			if (answer && "resetUrl" in answer) {
				assert.match(answer.resetUrl, /\/reset-password\/\S+/);
				assert.ok(answer.expiresAt > Date.now());
			} else if (answer && "sessionCount" in answer)
				assert.equal(answer.sessionCount, 0);
		}
		const person = await people.listPeople({ callerId: alice, clientIp: PEER });
		assert.ok(person.ok);
		assert.equal(
			person.value.find((entry) => entry.userId === carol)?.status,
			"Disabled",
		);
		await people.updatePerson({
			callerId: alice,
			clientIp: PEER,
			targetId: carol,
			status: "Active",
		});
	});

	it("allows People actions without a grant and ignores legacy tokens", async () => {
		for (const token of [undefined, "", "expired-or-forged"]) {
			assert.equal(refusalOf(await signOut(alice, carol, token)), undefined);
			assert.equal(
				refusalOf(await update(alice, carol, "Disabled", token)),
				undefined,
			);
			assert.equal(
				refusalOf(await update(alice, carol, "Active", token)),
				undefined,
			);
			assert.equal(refusalOf(await reset(alice, carol, token)), undefined);
		}
		const body = { status: "Active", stepUpToken: "ignored-legacy-body-token" };
		const validate = requestValidators.PeopleOperations_updatePerson?.[0];
		assert.ok(validate);
		assert.equal(
			validate({ path: { userId: carol }, header: {}, requestBody: body }),
			true,
		);
		assert.equal(
			refusalOf(
				await PeopleOperations.PeopleOperations_updatePerson(
					contextOf({ userId: carol }, body),
					callerOf(alice),
				),
			),
			undefined,
		);
		assert.equal(auditCount("action = 'StepUpPassed'"), 0);
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

	it("refuse to let a caller disable themselves, and record it", async () => {
		const answer = await update(alice, alice, "Disabled");
		assert.deepEqual(refusalOf(answer), [409, "cannot_disable_self"]);
		assert.equal(auditCount("actor = ? AND outcome = 'RefusedSelf'", alice), 1);
		assert.equal(
			(
				rows("SELECT disabled FROM auth_user WHERE id = ?", alice)[0] as {
					disabled: number;
				}
			).disabled,
			0,
		);
	});

	it("refuse a disabled caller on all five, and the second of two users disabling each other", async () => {
		const disabled = await update(alice, bob, "Disabled");
		assert.equal((disabled as { status: string }).status, "Disabled");

		const answers = [
			await listPeople(bob),
			await createStepUp(bob, alice, "Disable"),
			await signOut(bob, alice, "token"),
			await update(bob, alice, "Disabled"),
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
			run(
				"INSERT INTO calendar_feed_token (feed_token_id, account_config_id, calendar_id, token_hash, created_at, updated_at) VALUES (?, ?, 'cal', ?, 0, 0)",
				feedTokenId,
				deriveAccountConfigId(userId),
				`hash-${feedTokenId}`,
			);
		insertFeed(erin, "erin-feed");
		insertFeed(carol, "carol-feed");

		await update(alice, erin, "Disabled");

		assert.deepEqual(
			rows("SELECT feed_token_id AS id FROM calendar_feed_token"),
			[{ id: "carol-feed" }],
		);
	});

	it("sweep audit records older than 90 days on every insert", async () => {
		run(
			"INSERT INTO identity_audit_event (audit_event_id, occurred_at, actor, target, action, outcome, client_ip) VALUES ('ancient', ?, 'env', 'all', 'KillSwitchOn', 'Succeeded', 'host')",
			Date.now() - 91 * 24 * 60 * 60 * 1000,
		);
		await signOut(alice, carol);
		assert.equal(auditCount("audit_event_id = 'ancient'"), 0);
	});
});
