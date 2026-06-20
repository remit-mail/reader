import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/remit-electrodb-service";
import {
	isAccountDeleted,
	isAccountReauthRequired,
	isReservedHost,
	isUnsyncableHost,
} from "./account-check.js";

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

describe("isReservedHost", () => {
	const reserved = [
		"invalid",
		"example",
		"imap.invalid",
		"foo.invalid",
		"server.invalid",
		"SERVER.INVALID",
		"mail.example",
		"foo.example",
		"  imap.invalid  ",
	];
	for (const host of reserved) {
		it(`returns true for reserved host ${JSON.stringify(host)}`, () => {
			assert.equal(isReservedHost(host), true);
		});
	}

	// localhost / .localhost / .test are legitimately used by local & e2e envs,
	// so they must NOT be skipped (issue #835 follow-up).
	const real = [
		"imap.hostnet.nl",
		"imap.gmail.com",
		"localhost",
		"foo.localhost",
		"foo.test",
		"notlocalhost",
		"invalid.com",
		"example.com",
		"test.org",
	];
	for (const host of real) {
		it(`returns false for real host ${JSON.stringify(host)}`, () => {
			assert.equal(isReservedHost(host), false);
		});
	}
});

describe("isUnsyncableHost", () => {
	it("returns false for a resolvable host", () => {
		assert.equal(
			isUnsyncableHost(buildAccount({ imapHost: "imap.gmail.com" }), log),
			false,
		);
	});

	it("returns true for a reserved host", () => {
		assert.equal(
			isUnsyncableHost(buildAccount({ imapHost: "imap.invalid" }), log),
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
