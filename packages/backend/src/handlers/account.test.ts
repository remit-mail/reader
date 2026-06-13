import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AccountItem } from "@remit/remit-electrodb-service";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import { AccountAuthType } from "@remit/domain-enums";
import {
	assertNoDuplicateMailbox,
	assertNotOAuthCreate,
	assertPasswordProvided,
	findActiveDuplicateMailbox,
	toAccountResponse,
} from "./account-guards.js";
import { assertAccountOwnership } from "./account-ownership.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER = "owner-account-config-id";
const OTHER = "other-account-config-id";
const ACCOUNT_ID = "account-1";

describe("assertAccountOwnership", () => {
	it("returns silently when caller owns the account (read mode)", () => {
		assertAccountOwnership(
			{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
			OWNER,
			"read",
		);
	});

	it("returns silently when caller owns the account (act mode)", () => {
		assertAccountOwnership(
			{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
			OWNER,
			"act",
		);
	});

	it("throws NotFoundError on cross-tenant read (mirrors GET 404)", () => {
		assert.throws(
			() =>
				assertAccountOwnership(
					{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
					OTHER,
					"read",
				),
			(err: unknown) => {
				assert.ok(err instanceof NotFoundError);
				assert.equal(err.statusCode, 404);
				assert.match(err.message, new RegExp(ACCOUNT_ID));
				return true;
			},
		);
	});

	it("throws ForbiddenError on cross-tenant act (mirrors PATCH/DELETE/POST 403)", () => {
		assert.throws(
			() =>
				assertAccountOwnership(
					{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
					OTHER,
					"act",
				),
			(err: unknown) => {
				assert.ok(err instanceof ForbiddenError);
				assert.equal(err.statusCode, 403);
				assert.match(err.message, new RegExp(ACCOUNT_ID));
				return true;
			},
		);
	});

	it("does not leak the owner's accountConfigId in NotFoundError message", () => {
		assert.throws(
			() =>
				assertAccountOwnership(
					{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
					OTHER,
					"read",
				),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				assert.doesNotMatch(err.message, new RegExp(OWNER));
				return true;
			},
		);
	});

	it("does not leak the owner's accountConfigId in ForbiddenError message", () => {
		assert.throws(
			() =>
				assertAccountOwnership(
					{ accountId: ACCOUNT_ID, accountConfigId: OWNER },
					OTHER,
					"act",
				),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				assert.doesNotMatch(err.message, new RegExp(OWNER));
				return true;
			},
		);
	});
});

// ── toAccountResponse mapper tests ──────────────────────────────────────────

const makeAccountItem = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acc-1",
		accountConfigId: "cfg-1",
		username: "user@example.com",
		email: "user@example.com",
		authType: "password",
		passwordHash: '{"iv":"a","tag":"b","ciphertext":"c","keyId":"k"}',
		oauthRefreshTokenHash: '{"iv":"x","tag":"y","ciphertext":"z","keyId":"k"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}) as AccountItem;

describe("toAccountResponse — no token material in output", () => {
	it("does not include passwordHash in the response", () => {
		const response = toAccountResponse(makeAccountItem());
		const serialized = JSON.stringify(response);
		assert.doesNotMatch(
			serialized,
			/passwordHash/,
			"passwordHash must not appear in API response",
		);
	});

	it("does not include oauthRefreshTokenHash in the response", () => {
		const response = toAccountResponse(makeAccountItem());
		const serialized = JSON.stringify(response);
		assert.doesNotMatch(
			serialized,
			/oauthRefreshTokenHash/,
			"oauthRefreshTokenHash must not appear in API response",
		);
	});

	it("flows authType through the response", () => {
		const response = toAccountResponse(
			makeAccountItem({ authType: "oauthMicrosoft" }),
		);
		assert.equal(response.authType, "oauthMicrosoft");
	});

	it("defaults authType to 'password' when the field is absent on legacy rows", () => {
		// Build the item without authType to simulate a legacy row from before this migration
		const { authType: _dropped, ...rest } = makeAccountItem();
		const response = toAccountResponse(rest as AccountItem);
		assert.equal(response.authType, "password");
	});
});

// ── createAccount OAuth guard ────────────────────────────────────────────────

describe("assertNotOAuthCreate", () => {
	it("throws 400 when authType is oauthMicrosoft", () => {
		assert.throws(
			() => assertNotOAuthCreate("oauthMicrosoft"),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				const typed = err as Error & { status?: number; message: string };
				assert.equal(typed.status, 400);
				assert.match(
					typed.message,
					/OAuth accounts must be created via the OAuth connect flow/,
				);
				return true;
			},
		);
	});

	it("does not throw for password accounts", () => {
		assert.doesNotThrow(() => assertNotOAuthCreate("password"));
	});

	it("does not throw when authType is omitted", () => {
		assert.doesNotThrow(() => assertNotOAuthCreate(undefined));
	});
});

// ── createAccount password guard ────────────────────────────────────────────

describe("assertPasswordProvided", () => {
	it("throws 400 when authType is 'password' and password is missing", () => {
		assert.throws(
			() => assertPasswordProvided("password", undefined),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				const typed = err as Error & { status?: number; message: string };
				assert.equal(typed.status, 400);
				assert.match(typed.message, /password is required/);
				return true;
			},
		);
	});

	it("throws 400 when authType is omitted (default password) and password is missing", () => {
		assert.throws(
			() => assertPasswordProvided(undefined, undefined),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				const typed = err as Error & { status?: number; message: string };
				assert.equal(typed.status, 400);
				assert.match(typed.message, /password is required/);
				return true;
			},
		);
	});

	it("throws 400 when password is empty string", () => {
		assert.throws(
			() => assertPasswordProvided("password", ""),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				const typed = err as Error & { status?: number };
				assert.equal(typed.status, 400);
				return true;
			},
		);
	});

	it("does not throw when password is provided for password-auth account", () => {
		assert.doesNotThrow(() => assertPasswordProvided("password", "s3cret"));
	});

	it("does not throw when authType is omitted and password is provided", () => {
		assert.doesNotThrow(() => assertPasswordProvided(undefined, "s3cret"));
	});
});

// ── deleteAccount per-account purge trigger ──────────────────────────
//
// deleteAccount soft-marks the account row, then emits an AccountDataPurge
// event to the account-fanout queue so the worker purges this one account's
// data (mailboxes, messages, S3, vectors) while keeping the AccountConfig and
// any sibling accounts. Source-contract guards mirror me.ts: the handler must
// read the exact env var name the infra injects and emit the exact event shape
// the worker dispatches on.

describe("deleteAccount emits AccountDataPurge fanout event", () => {
	const source = readFileSync(resolve(__dirname, "./account.ts"), "utf-8");

	it("reads SQS_QUEUE_URL_ACCOUNT_FANOUT for the purge enqueue", () => {
		assert.match(source, /env\.SQS_QUEUE_URL_ACCOUNT_FANOUT/);
	});

	it("emits an AccountDataPurge event carrying accountId and accountConfigId", () => {
		assert.match(source, /type:\s*"AccountDataPurge"/);
		const block = source.slice(
			source.indexOf("AccountDetailOperations_deleteAccount"),
		);
		assert.match(block, /SendMessageCommand/);
		assert.match(block, /accountId,\s*\n\s*accountConfigId,/);
	});
});

// ── onboard uniqueness guard (#635) ──────────────────────────────────────────
//
// Explicit server-side replacement for the old determinism-as-dedup behavior:
// reject a second create for the same mailbox-in-the-same-place (host + login),
// while ignoring soft-deleted accounts so re-onboard after delete still works.

const makeMailbox = (overrides: Partial<AccountItem> = {}): AccountItem =>
	makeAccountItem({
		username: "alice@example.com",
		email: "alice@example.com",
		imapHost: "imap.example.com",
		...overrides,
	});

describe("findActiveDuplicateMailbox", () => {
	it("returns undefined for a first-time onboard (no existing accounts)", () => {
		assert.equal(
			findActiveDuplicateMailbox([], {
				imapHost: "imap.example.com",
				username: "alice@example.com",
			}),
			undefined,
		);
	});

	it("matches an active account with the same host and username", () => {
		const existing = makeMailbox({ accountId: "dupe" });
		const found = findActiveDuplicateMailbox([existing], {
			imapHost: "imap.example.com",
			username: "alice@example.com",
		});
		assert.equal(found?.accountId, "dupe");
	});

	it("matches case-insensitively on host and username", () => {
		const existing = makeMailbox({ accountId: "dupe" });
		const found = findActiveDuplicateMailbox([existing], {
			imapHost: "IMAP.Example.COM",
			username: "Alice@Example.com",
		});
		assert.equal(found?.accountId, "dupe");
	});

	it("ignores soft-deleted accounts so re-onboard after delete works", () => {
		const deleted = makeMailbox({ accountId: "old", deletedAt: 123 });
		const found = findActiveDuplicateMailbox([deleted], {
			imapHost: "imap.example.com",
			username: "alice@example.com",
		});
		assert.equal(found, undefined);
	});

	it("does not match a different username on the same host", () => {
		const existing = makeMailbox({ accountId: "dupe" });
		const found = findActiveDuplicateMailbox([existing], {
			imapHost: "imap.example.com",
			username: "bob@example.com",
		});
		assert.equal(found, undefined);
	});

	it("does not match the same username on a different host", () => {
		const existing = makeMailbox({ accountId: "dupe" });
		const found = findActiveDuplicateMailbox([existing], {
			imapHost: "imap.other.com",
			username: "alice@example.com",
		});
		assert.equal(found, undefined);
	});
});

describe("assertNoDuplicateMailbox", () => {
	it("does not throw on a first-time onboard", () => {
		assert.doesNotThrow(() =>
			assertNoDuplicateMailbox([], {
				imapHost: "imap.example.com",
				username: "alice@example.com",
			}),
		);
	});

	it("throws a 409 ConflictError on a second active onboard of the same mailbox", () => {
		const existing = makeMailbox();
		assert.throws(
			() =>
				assertNoDuplicateMailbox([existing], {
					imapHost: "imap.example.com",
					username: "alice@example.com",
				}),
			(err: unknown) => {
				assert.ok(err instanceof ConflictError);
				assert.equal(err.statusCode, 409);
				assert.match(err.message, /already exists/);
				return true;
			},
		);
	});

	it("does not throw when the prior account is soft-deleted (re-onboard)", () => {
		const deleted = makeMailbox({ deletedAt: 123 });
		assert.doesNotThrow(() =>
			assertNoDuplicateMailbox([deleted], {
				imapHost: "imap.example.com",
				username: "alice@example.com",
			}),
		);
	});

	it("covers the OAuth natural key (fixed Outlook host + email as username)", () => {
		const oauth = makeMailbox({
			authType: AccountAuthType.OauthMicrosoft,
			username: "user@outlook.com",
			email: "user@outlook.com",
			imapHost: "outlook.office365.com",
		});
		assert.throws(
			() =>
				assertNoDuplicateMailbox([oauth], {
					imapHost: "outlook.office365.com",
					username: "user@outlook.com",
				}),
			(err: unknown) => {
				assert.ok(err instanceof ConflictError);
				return true;
			},
		);
	});
});
