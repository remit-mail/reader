import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { compareAccounts, sortAccountsByCreatedAt } from "./account-order.js";

const account = (
	overrides: Partial<RemitImapAccountResponse> &
		Pick<RemitImapAccountResponse, "accountId" | "createdAt">,
): RemitImapAccountResponse =>
	({
		accountConfigId: "cfg-1",
		username: "user",
		email: "user@example.com",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		smtpTls: false,
		smtpStartTls: true,
		smtpUsername: "user",
		isActive: true,
		updatedAt: overrides.createdAt,
		...overrides,
	}) as RemitImapAccountResponse;

describe("compareAccounts", () => {
	test("oldest createdAt sorts first", () => {
		const a = account({ accountId: "z", createdAt: 1000 });
		const b = account({ accountId: "a", createdAt: 2000 });
		assert.ok(compareAccounts(a, b) < 0);
		assert.ok(compareAccounts(b, a) > 0);
	});

	test("ties on createdAt are broken by accountId ascending", () => {
		const a = account({ accountId: "a", createdAt: 1000 });
		const b = account({ accountId: "b", createdAt: 1000 });
		assert.ok(compareAccounts(a, b) < 0);
		assert.ok(compareAccounts(b, a) > 0);
	});

	test("identical accounts compare equal", () => {
		const a = account({ accountId: "x", createdAt: 1000 });
		const b = account({ accountId: "x", createdAt: 1000 });
		assert.strictEqual(compareAccounts(a, b), 0);
	});
});

describe("sortAccountsByCreatedAt", () => {
	test("returns a new array sorted oldest-first", () => {
		const input = [
			account({ accountId: "c", createdAt: 3000 }),
			account({ accountId: "a", createdAt: 1000 }),
			account({ accountId: "b", createdAt: 2000 }),
		];
		const sorted = sortAccountsByCreatedAt(input);
		assert.deepStrictEqual(
			sorted.map((a) => a.accountId),
			["a", "b", "c"],
		);
		assert.deepStrictEqual(
			input.map((a) => a.accountId),
			["c", "a", "b"],
		);
	});

	test("ties on createdAt sort by accountId", () => {
		const input = [
			account({ accountId: "z", createdAt: 1000 }),
			account({ accountId: "a", createdAt: 1000 }),
			account({ accountId: "m", createdAt: 1000 }),
		];
		const sorted = sortAccountsByCreatedAt(input);
		assert.deepStrictEqual(
			sorted.map((a) => a.accountId),
			["a", "m", "z"],
		);
	});

	test("empty input returns empty array", () => {
		assert.deepStrictEqual(sortAccountsByCreatedAt([]), []);
	});
});
