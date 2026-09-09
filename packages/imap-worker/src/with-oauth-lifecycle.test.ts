import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { ImapFlowConnection } from "@remit/mailbox-service/imapflow-connection";
import {
	MailConnectionError,
	type MailCredentials,
} from "@remit/mailbox-service/types";
import {
	type ConnectionStateValue,
	type OAuthLifecycleDeps,
	withOAuthLifecycle,
} from "./with-oauth-lifecycle.js";

const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	fatal: () => {},
	child: () => silentLogger,
} as never;

const buildAccount = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acc-1",
		accountConfigId: "cfg-1",
		username: "alice@example.com",
		email: "alice@example.com",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as unknown as AccountItem;

interface Recorded {
	stateUpdates: Array<{
		accountId: string;
		state: ConnectionStateValue;
		lastError?: string;
	}>;
	resolveCalls: number;
	workCalls: number;
}

/** What Microsoft says to a mailbox whose tenant has IMAP switched off. */
const REFUSAL =
	"LOGIN failed. User is authenticated but not connected. SmtpClientAuthentication is disabled for the Tenant.";

const passwordCreds: MailCredentials = {
	kind: "password",
	password: "secret",
};

const buildDeps = (
	options: {
		resolveCredentials?: OAuthLifecycleDeps["resolveCredentials"];
	} = {},
): { deps: OAuthLifecycleDeps; recorded: Recorded } => {
	const recorded: Recorded = {
		stateUpdates: [],
		resolveCalls: 0,
		workCalls: 0,
	};
	const deps: OAuthLifecycleDeps = {
		secrets: {
			decrypt: async () => "",
			encrypt: async () => ({}) as never,
		},
		tokenService: { getAccessToken: async () => ({}) as never },
		persistRotatedToken: async () => {},
		updateConnectionState: async (accountId, state, lastError) => {
			recorded.stateUpdates.push({ accountId, state, lastError });
		},
		resolveCredentials:
			options.resolveCredentials ??
			(async () => {
				recorded.resolveCalls += 1;
				return { status: "resolved", credentials: passwordCreds };
			}),
	};
	// Wrap resolveCredentials to record the call count when a custom one is given.
	if (options.resolveCredentials) {
		const inner = options.resolveCredentials;
		deps.resolveCredentials = async (account, credDeps) => {
			recorded.resolveCalls += 1;
			return inner(account, credDeps);
		};
	}
	return { deps, recorded };
};

describe("withOAuthLifecycle", () => {
	it("skips work when account is reauth_required", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount({ connectionState: "reauth_required" });

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			recorded.workCalls += 1;
		});

		assert.equal(recorded.workCalls, 0, "work must not be called");
		assert.equal(recorded.resolveCalls, 0, "must not resolve credentials");
		assert.equal(recorded.stateUpdates.length, 0, "must not update state");
	});

	it("on RefreshTokenError reauth-required: flips to reauth_required and ACKs (does not rethrow)", async () => {
		const { deps, recorded } = buildDeps({
			resolveCredentials: async () => {
				throw new RefreshTokenError({
					kind: "reauth-required",
					code: "invalid_grant",
				});
			},
		});
		const account = buildAccount();

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			recorded.workCalls += 1;
		});

		assert.equal(
			recorded.workCalls,
			0,
			"work must not run after resolve fails",
		);
		assert.equal(recorded.stateUpdates.length, 1);
		// A revoked token has nothing to add: re-authenticating is the whole of
		// what the account needs, and the card says so on its own.
		assert.deepEqual(recorded.stateUpdates[0], {
			accountId: "acc-1",
			state: ConnectionState.ReauthRequired,
			lastError: undefined,
		});
	});

	it("on MailConnectionError auth for OAuth account: flips to reauth_required and ACKs", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount({ authType: AccountAuthType.OauthMicrosoft });

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			throw new MailConnectionError("auth", "auth failed");
		});

		assert.equal(recorded.stateUpdates.length, 1);
		assert.deepEqual(recorded.stateUpdates[0], {
			accountId: "acc-1",
			state: ConnectionState.ReauthRequired,
			lastError: "auth failed",
		});
	});

	it("keeps what the server said when it refused, so the card can repeat it", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount({ authType: AccountAuthType.OauthMicrosoft });

		// The error an Exchange mailbox with IMAP switched off hands back, built
		// the way imapflow builds it and classified by the code that ships.
		const connection = new ImapFlowConnection({
			host: "outlook.office365.com",
			port: 993,
			user: "matthijs@example.com",
			credentials: { kind: "accessToken", accessToken: "access-token" },
			tls: true,
		});
		mock.method(
			connection as unknown as { attemptConnect: () => Promise<void> },
			"attemptConnect",
			async () => {
				throw Object.assign(new Error("Command failed"), {
					authenticationFailed: true,
					serverResponseCode: "AUTHENTICATIONFAILED",
					responseText: REFUSAL,
				});
			},
		);

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			await connection.connect();
		});

		assert.equal(recorded.stateUpdates.length, 1);
		assert.equal(
			recorded.stateUpdates[0].state,
			ConnectionState.ReauthRequired,
		);
		assert.ok(
			recorded.stateUpdates[0].lastError?.includes(REFUSAL),
			`the refusal must survive to the account row, got: ${recorded.stateUpdates[0].lastError}`,
		);
	});

	it("on MailConnectionError auth for password account: rethrows (batch item failure, no state flip)", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount({ authType: AccountAuthType.Password });

		await assert.rejects(
			() =>
				withOAuthLifecycle(deps, account, silentLogger, async () => {
					throw new MailConnectionError("auth", "auth failed");
				}),
			/auth failed/,
		);
		assert.equal(
			recorded.stateUpdates.length,
			0,
			"must not flip connectionState for password account",
		);
	});

	it("on MailConnectionError auth for account with no authType (defaults to password): rethrows", async () => {
		const { deps, recorded } = buildDeps();
		// No authType set — defaults to password in resolveConnectionCredentials
		const account = buildAccount();

		await assert.rejects(
			() =>
				withOAuthLifecycle(deps, account, silentLogger, async () => {
					throw new MailConnectionError("auth", "auth failed");
				}),
			/auth failed/,
		);
		assert.equal(
			recorded.stateUpdates.length,
			0,
			"must not flip connectionState when authType is unset",
		);
	});

	it("on transient error (network): rethrows (batch item failure)", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount();

		await assert.rejects(
			() =>
				withOAuthLifecycle(deps, account, silentLogger, async () => {
					throw new MailConnectionError("network", "timeout");
				}),
			/timeout/,
		);
		assert.equal(recorded.stateUpdates.length, 0, "must not flip state");
	});

	it("on ordinary Error: rethrows", async () => {
		const { deps, recorded } = buildDeps();
		const account = buildAccount();

		await assert.rejects(
			() =>
				withOAuthLifecycle(deps, account, silentLogger, async () => {
					throw new Error("boom");
				}),
			/boom/,
		);
		assert.equal(recorded.stateUpdates.length, 0);
	});

	it("password account with no passwordHash: ACKs and flips to credentials_missing", async () => {
		const { deps, recorded } = buildDeps();
		delete deps.resolveCredentials;
		const account = buildAccount({ authType: AccountAuthType.Password });

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			recorded.workCalls += 1;
		});

		assert.equal(recorded.workCalls, 0, "no IMAP traffic without a credential");
		assert.deepEqual(recorded.stateUpdates, [
			{
				accountId: "acc-1",
				state: ConnectionState.CredentialsMissing,
				lastError: undefined,
			},
		]);
	});

	it("OAuth account with no refresh token: ACKs and flips to reauth_required", async () => {
		const { deps, recorded } = buildDeps();
		delete deps.resolveCredentials;
		const account = buildAccount({ authType: AccountAuthType.OauthMicrosoft });

		await withOAuthLifecycle(deps, account, silentLogger, async () => {
			recorded.workCalls += 1;
		});

		assert.equal(recorded.workCalls, 0, "no IMAP traffic without a credential");
		assert.deepEqual(recorded.stateUpdates, [
			{
				accountId: "acc-1",
				state: ConnectionState.ReauthRequired,
				lastError: undefined,
			},
		]);
	});

	it("on RefreshTokenError transient: rethrows", async () => {
		const { deps, recorded } = buildDeps({
			resolveCredentials: async () => {
				throw new RefreshTokenError({ kind: "transient", code: "503" });
			},
		});
		const account = buildAccount();

		await assert.rejects(
			() => withOAuthLifecycle(deps, account, silentLogger, async () => {}),
			/transient/,
		);
		assert.equal(recorded.stateUpdates.length, 0, "must not flip state");
	});
});
