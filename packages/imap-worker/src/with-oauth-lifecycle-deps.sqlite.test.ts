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
