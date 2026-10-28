/**
 * What a read-path borrow does with an account it cannot connect.
 *
 * The scope opens a body fetch's connection, so a credential it cannot resolve
 * has to end as a refusal the client can act on and an account card that says
 * why — never as a 500 that leaves the card claiming the account is fine.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import {
	type AccountRepo,
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import type { ConnectionScope } from "@remit/mailbox-service";
import type { SecretsService } from "@remit/secrets-service";
import type { TokenService } from "./context.js";
import {
	AccountNeedsReconnectError,
	lifecycleConnectionScope,
} from "./lifecycle-connection-scope.js";

const SEALED = JSON.stringify({
	encryptedDek: "",
	encryptedData: "",
	iv: "",
	authTag: "",
});

const secrets = {
	decrypt: async () => "refresh-token",
	encrypt: async () => ({}) as never,
} as unknown as SecretsService;

const revoked: TokenService = {
	getAccessToken: async () => {
		throw new RefreshTokenError({
			kind: "reauth-required",
			code: "invalid_grant",
		});
	},
};

const minting: TokenService = {
	getAccessToken: async () => ({
		accessToken: "access-token",
		expiresAt: Math.floor(Date.now() / 1000) + 3600,
		grantedScopes: [],
	}),
};

const opened: ConnectionScope = {
	getConnection: async () => {
		throw new Error("no connection is made in these tests");
	},
	disconnect: async () => {},
};

let repo: AccountRepo;
let close: () => void;

const outlookAccount = (): Promise<AccountItem> =>
	repo.create({
		accountConfigId: "cfg-1",
		username: "matthijs@example.com",
		email: "matthijs@example.com",
		authType: AccountAuthType.OauthMicrosoft,
		oauthRefreshTokenHash: SEALED,
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
	repo = createSqliteRepositories(
		{ app: db.db, mail: db.db, search: db.db },
		BETTER_SQLITE3_LIMITS,
	).account;
});

after(() => {
	close();
});

describe("a read-path connection scope", () => {
	it("opens the connection with the token it minted", async () => {
		const created = await outlookAccount();
		const seen: unknown[] = [];

		const scope = await lifecycleConnectionScope(
			minting,
			(_account, credentials) => {
				seen.push(credentials);
				return opened;
			},
		)(
			repo,
			secrets,
		)(created.accountId);

		assert.equal(scope, opened);
		assert.deepEqual(seen, [
			{ kind: "accessToken", accessToken: "access-token" },
		]);
	});

	it("refuses with 409 and flips the account when its consent was withdrawn", async () => {
		const created = await outlookAccount();

		await assert.rejects(
			lifecycleConnectionScope(revoked, () => opened)(repo, secrets)(
				created.accountId,
			),
			(error: unknown) =>
				error instanceof AccountNeedsReconnectError && error.statusCode === 409,
		);

		const stored = await repo.get(created.accountId);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
	});

	it("refuses an account that stores no credential", async () => {
		const created = await repo.create({
			accountConfigId: "cfg-1",
			username: "person@example.com",
			email: "person@example.com",
			authType: AccountAuthType.Password,
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});

		await assert.rejects(
			lifecycleConnectionScope(minting, () => opened)(repo, secrets)(
				created.accountId,
			),
			AccountNeedsReconnectError,
		);

		const stored = await repo.get(created.accountId);
		assert.notEqual(stored.connectionState, ConnectionState.Authenticated);
	});
});
