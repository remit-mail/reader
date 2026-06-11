import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/remit-electrodb-service";
import { ForbiddenError, NotFoundError } from "@remit/remit-electrodb-service";
import { AccountAuthType } from "@remit/domain-enums";
import {
	assertNotOAuthCreate,
	assertPasswordProvided,
	toAccountResponse,
} from "./account-guards.js";
import { assertAccountOwnership } from "./account-ownership.js";

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
