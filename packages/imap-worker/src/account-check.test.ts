import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/remit-electrodb-service";
import { isAccountDeleted, isAccountReauthRequired } from "./account-check.js";

const log = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
} as unknown as Parameters<typeof isAccountDeleted>[1];

const buildAccount = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acct-1",
		connectionState: "authenticated",
		...overrides,
	}) as unknown as AccountItem;

describe("isAccountDeleted", () => {
	it("returns false when deletedAt is absent", () => {
		assert.equal(isAccountDeleted(buildAccount(), log), false);
	});

	it("returns true when deletedAt is set", () => {
		assert.equal(
			isAccountDeleted(buildAccount({ deletedAt: Date.now() }), log),
			true,
		);
	});
});

describe("isAccountReauthRequired", () => {
	it("returns false for authenticated accounts", () => {
		assert.equal(
			isAccountReauthRequired(
				buildAccount({ connectionState: "authenticated" }),
				log,
			),
			false,
		);
	});

	it("returns false for not_authenticated accounts", () => {
		assert.equal(
			isAccountReauthRequired(
				buildAccount({ connectionState: "not_authenticated" }),
				log,
			),
			false,
		);
	});

	it("returns true when connectionState is reauth_required", () => {
		assert.equal(
			isAccountReauthRequired(
				buildAccount({ connectionState: "reauth_required" }),
				log,
			),
			true,
		);
	});
});
