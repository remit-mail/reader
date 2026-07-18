import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	MailConnectionError,
	type MailCredentials,
} from "@remit/mailbox-service";
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
	stateUpdates: Array<{ accountId: string; state: ConnectionStateValue }>;
	resolveCalls: number;
	workCalls: number;
}

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
		updateConnectionState: async (accountId, state) => {
			recorded.stateUpdates.push({ accountId, state });
		},
		resolveCredentials:
			options.resolveCredentials ??
			(async () => {
				recorded.resolveCalls += 1;
				return passwordCreds;
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
		assert.deepEqual(recorded.stateUpdates[0], {
			accountId: "acc-1",
			state: ConnectionState.ReauthRequired,
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
		});
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
