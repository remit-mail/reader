/**
 * What the account row holds after the lifecycle has written to it.
 *
 * The deps builder is the half that talks to the store, so it is tested against
 * the real repository over the shipped SQLite schema rather than a stand-in
 * that would only agree with itself: whether a stored reason survives, and
 * whether one that no longer applies is gone, is decided by the repository's
 * update semantics, where an absent field means "leave it alone".
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { AccountRepo } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { MailConnectionError } from "@remit/mailbox-service/types";
import type { SecretsService } from "@remit/secrets-service";
import {
	type OAuthLifecycleDeps,
	withOAuthLifecycle,
} from "./with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "./with-oauth-lifecycle-deps.js";

const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	fatal: () => {},
	child: () => silentLogger,
} as never;

const secrets = {
	decrypt: async () => "decrypted",
	encrypt: async () => ({}) as never,
} as unknown as SecretsService;

/**
 * The real deps, with only credential resolution stubbed — minting a token is
 * a call to Microsoft and not what these tests are about. `updateConnectionState`
 * is the one under test and stays exactly as the handlers build it.
 */
const deps = (): OAuthLifecycleDeps => ({
	...buildLifecycleDeps(secrets, repo),
	resolveCredentials: async () => ({
		status: "resolved",
		credentials: { kind: "accessToken", accessToken: "access-token" },
	}),
});

const STALE_SYNC_ERROR = "Mailbox does not exist: [NONEXISTENT]";
const REFUSAL =
	"IMAP authentication failed: LOGIN failed. User is authenticated but not connected.";

let repo: AccountRepo;
let close: () => void;

const account = async (): Promise<AccountItem> =>
	repo.create({
		accountConfigId: "cfg-1",
		username: "matthijs@example.com",
		email: "matthijs@example.com",
		authType: AccountAuthType.OauthMicrosoft,
		oauthRefreshTokenHash: "encrypted-refresh-token",
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});

before(() => {
	const db = createShippedSqliteDb();
	close = db.close;
	repo = new AccountRepo(db.db);
});

after(() => {
	close();
});

describe("the reason an account card reads back", () => {
	it("keeps the refusal the mail server gave", async () => {
		const created = await account();

		await withOAuthLifecycle(deps(), created, silentLogger, async () => {
			throw new MailConnectionError("auth", REFUSAL);
		});

		const stored = await repo.get(created.accountId);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
		assert.equal(stored.lastError, REFUSAL);
	});

	it("drops a reason the account has moved on from", async () => {
		const created = await account();
		// What a failed sync leaves behind (sync-mailboxes.ts): a folder that went
		// away, nothing to do with signing in.
		await repo.update(created.accountId, { lastError: STALE_SYNC_ERROR });

		// Hours later the refresh token is revoked. Re-authenticating is now the
		// whole story, and the mailbox that went missing is not it.
		await withOAuthLifecycle(
			deps(),
			await repo.get(created.accountId),
			silentLogger,
			async () => {
				throw new RefreshTokenError({
					kind: "reauth-required",
					code: "invalid_grant",
				});
			},
		);

		const stored = await repo.get(created.accountId);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
		assert.equal(
			stored.lastError,
			undefined,
			"a stale sync error beside a Reconnect button reads as the reason for it",
		);
	});

	it("stores a chatty refusal at a length a card can hold", async () => {
		const created = await account();

		await withOAuthLifecycle(deps(), created, silentLogger, async () => {
			throw new MailConnectionError("auth", "x".repeat(4000));
		});

		const stored = await repo.get(created.accountId);
		assert.equal(stored.lastError?.length, 500);
	});
});

describe("which failures stop the work, and what the account row says after", () => {
	const passwordAccount = (passwordHash?: string): Promise<AccountItem> =>
		repo.create({
			accountConfigId: "cfg-1",
			username: "person@example.com",
			email: "person@example.com",
			authType: AccountAuthType.Password,
			passwordHash,
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});

	it("runs nothing for an account that has to sign in again", async () => {
		const created = await account();
		await repo.update(created.accountId, {
			connectionState: ConnectionState.ReauthRequired,
		});
		let worked = false;

		await withOAuthLifecycle(
			deps(),
			await repo.get(created.accountId),
			silentLogger,
			async () => {
				worked = true;
			},
		);

		assert.equal(worked, false);
	});

	// Issue #1120: a password account with nothing stored can only fail, and a
	// failing batch item fences the account's FIFO group.
	it("acks a password account that stores no password and says the credential is missing", async () => {
		const created = await passwordAccount();
		let worked = false;

		await withOAuthLifecycle(
			buildLifecycleDeps(secrets, repo),
			created,
			silentLogger,
			async () => {
				worked = true;
			},
		);

		assert.equal(worked, false);
		assert.equal(
			(await repo.get(created.accountId)).connectionState,
			ConnectionState.CredentialsMissing,
		);
	});

	it("acks an OAuth account that holds no refresh token and asks for a sign-in", async () => {
		const created = await repo.create({
			accountConfigId: "cfg-1",
			username: "matthijs@example.com",
			email: "matthijs@example.com",
			authType: AccountAuthType.OauthMicrosoft,
			imapHost: "outlook.office365.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});

		await withOAuthLifecycle(
			buildLifecycleDeps(secrets, repo),
			created,
			silentLogger,
			async () => {},
		);

		assert.equal(
			(await repo.get(created.accountId)).connectionState,
			ConnectionState.ReauthRequired,
		);
	});

	// A password that stopped working is the user's to fix in settings; the
	// state flip is reserved for OAuth, where a sign-in is the fix.
	for (const [name, error] of [
		["a refused password", new MailConnectionError("auth", "auth failed")],
		["a network failure", new MailConnectionError("network", "timeout")],
		["any other error", new Error("boom")],
	] as const) {
		it(`redelivers ${name} on a password account and leaves its state alone`, async () => {
			const created = await passwordAccount('{"ciphertext":"x"}');

			await assert.rejects(
				withOAuthLifecycle(deps(), created, silentLogger, async () => {
					throw error;
				}),
				error,
			);

			assert.equal(
				(await repo.get(created.accountId)).connectionState,
				ConnectionState.Authenticated,
			);
		});
	}

	it("redelivers a transient token failure and leaves the state alone", async () => {
		const created = await account();

		await assert.rejects(
			withOAuthLifecycle(
				{
					...deps(),
					resolveCredentials: async () => {
						throw new RefreshTokenError({ kind: "transient", code: "503" });
					},
				},
				created,
				silentLogger,
				async () => {},
			),
			/transient/,
		);

		assert.equal(
			(await repo.get(created.accountId)).connectionState,
			ConnectionState.Authenticated,
		);
	});
});
