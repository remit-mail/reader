import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenError, NotFoundError } from "@remit/remit-electrodb-service";
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
