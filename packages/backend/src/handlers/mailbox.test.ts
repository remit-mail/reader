import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RenameMailboxInput } from "@remit/api-openapi-types";
import {
	ForbiddenError,
	type MailboxItem,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import {
	applyMailboxPatch,
	assertMailboxInAccount,
	type MailboxPatchClient,
	pickMailboxOverrideChanges,
} from "./mailbox.js";

const MUTED_FLAG = {
	value: true,
	setAt: 1_700_000_000_000,
	setBy: "device-a",
};

describe("assertMailboxInAccount", () => {
	const mailbox = {
		mailboxId: "mbx-1",
		accountId: "acct-owner",
	} satisfies Pick<MailboxItem, "mailboxId" | "accountId">;

	it("passes when the mailbox belongs to the account", () => {
		assert.doesNotThrow(() =>
			assertMailboxInAccount(mailbox, "acct-owner", "read"),
		);
		assert.doesNotThrow(() =>
			assertMailboxInAccount(mailbox, "acct-owner", "act"),
		);
	});

	it("throws NotFound on a cross-account read (no existence leak)", () => {
		assert.throws(
			() => assertMailboxInAccount(mailbox, "acct-other", "read"),
			(err: unknown) =>
				err instanceof NotFoundError && /Mailbox not found/.test(err.message),
		);
	});

	it("throws Forbidden on a cross-account action", () => {
		assert.throws(
			() => assertMailboxInAccount(mailbox, "acct-other", "act"),
			(err: unknown) =>
				err instanceof ForbiddenError && /not in account/.test(err.message),
		);
	});
});

describe("pickMailboxOverrideChanges", () => {
	it("returns empty changes when no override key is present (no-op)", () => {
		const body = { fullPath: "INBOX" } as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), {});
	});

	it("picks muted flag when a MutedFlag object is provided", () => {
		const body = { muted: MUTED_FLAG } as unknown as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), { muted: MUTED_FLAG });
	});

	it("picks muted null (clear signal)", () => {
		const body = { muted: null } as unknown as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), { muted: null });
	});

	it("picks displayNameOverride when a string is provided", () => {
		const body = { displayNameOverride: "Work Stuff" } as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), {
			displayNameOverride: "Work Stuff",
		});
	});

	it("picks displayNameOverride null (clear signal)", () => {
		const body = {
			displayNameOverride: null,
		} as unknown as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), {
			displayNameOverride: null,
		});
	});

	it("combines set and clear across override fields", () => {
		const body = {
			displayNameOverride: "Receipts",
			muted: MUTED_FLAG,
		} as unknown as RenameMailboxInput;
		assert.deepEqual(pickMailboxOverrideChanges(body), {
			displayNameOverride: "Receipts",
			muted: MUTED_FLAG,
		});
	});

	it("never includes fullPath in the picked override changes", () => {
		const body = {
			fullPath: "INBOX",
			muted: MUTED_FLAG,
		} as unknown as RenameMailboxInput;
		const changes = pickMailboxOverrideChanges(body);
		assert.ok(
			!Object.hasOwn(changes, "fullPath"),
			"fullPath must not appear in override changes",
		);
	});
});

// ── Handler-level tests for the no-rename guarantee ──────────────────
// The acceptance criterion: an override-only PATCH "sets and clears the mailbox
// mute / display-name / role without touching the rename/sync-status
// machinery". Overrides are written to per-mailbox AccountSetting rows (RFC 032),
// so these tests stub accountSetting + the client and assert
// mailboxQueue.renameMailbox is (not) invoked and the right setting writes fire.

const ACCOUNT_CONFIG_ID = "cfg-1";
const MAILBOX_ID = "mb-1";
const ACCOUNT_ID = "acc-1";

const makeStubClient = () => {
	const calls = {
		upsert: [] as unknown[],
		delete: [] as unknown[][],
		get: 0,
		renameMailbox: [] as unknown[][],
	};
	const item = { mailboxId: MAILBOX_ID } as unknown as MailboxItem;
	const client: MailboxPatchClient = {
		mailbox: {
			get: async (_mailboxId) => {
				calls.get += 1;
				return item;
			},
		},
		mailboxQueue: {
			renameMailbox: async (mailboxId, newPath, accountId) => {
				calls.renameMailbox.push([mailboxId, newPath, accountId]);
				return item;
			},
		},
		accountSetting: {
			upsert: async (input: unknown) => {
				calls.upsert.push(input);
				return input as never;
			},
			delete: async (accountConfigId: string, name: string) => {
				calls.delete.push([accountConfigId, name]);
			},
		} as MailboxPatchClient["accountSetting"],
	};
	return { client, calls, item };
};

describe("applyMailboxPatch", () => {
	it("mute-only PATCH (set) writes the setting and never renames", async () => {
		const { client, calls } = makeStubClient();
		const body = { muted: MUTED_FLAG } as unknown as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.renameMailbox.length, 0);
		assert.deepEqual(calls.upsert, [
			{
				accountConfigId: ACCOUNT_CONFIG_ID,
				name: `MailboxMuted#${MAILBOX_ID}`,
				value: { kind: "MutedFlag", value: MUTED_FLAG },
			},
		]);
		assert.equal(calls.get, 1, "responds with a fresh get, not a rename");
	});

	it("mute-only PATCH (clear via null) deletes the setting and never renames", async () => {
		const { client, calls } = makeStubClient();
		const body = { muted: null } as unknown as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.renameMailbox.length, 0);
		assert.deepEqual(calls.delete, [
			[ACCOUNT_CONFIG_ID, `MailboxMuted#${MAILBOX_ID}`],
		]);
	});

	it("PATCH with fullPath renames and writes no setting", async () => {
		const { client, calls } = makeStubClient();
		const body = { fullPath: "Archive/2026" } as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.deepEqual(calls.renameMailbox, [
			[MAILBOX_ID, "Archive/2026", ACCOUNT_ID],
		]);
		assert.equal(calls.upsert.length, 0);
		assert.equal(calls.delete.length, 0);
	});

	it("combined PATCH writes the setting and then renames", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			fullPath: "Archive/2026",
			muted: MUTED_FLAG,
		} as unknown as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.upsert.length, 1);
		assert.deepEqual(calls.renameMailbox, [
			[MAILBOX_ID, "Archive/2026", ACCOUNT_ID],
		]);
	});

	it("override-only PATCH (display name) writes the setting, no rename", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			displayNameOverride: "Receipts",
		} as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.renameMailbox.length, 0);
		assert.deepEqual(calls.upsert, [
			{
				accountConfigId: ACCOUNT_CONFIG_ID,
				name: `MailboxDisplayName#${MAILBOX_ID}`,
				value: { kind: "String", value: "Receipts" },
			},
		]);
		assert.equal(calls.get, 1, "responds with a fresh get, not a rename");
	});

	it("override-only PATCH (clear via null) deletes the setting", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			displayNameOverride: null,
		} as unknown as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.renameMailbox.length, 0);
		assert.deepEqual(calls.delete, [
			[ACCOUNT_CONFIG_ID, `MailboxDisplayName#${MAILBOX_ID}`],
		]);
	});

	it("empty PATCH body is a no-op: no setting write, no rename", async () => {
		const { client, calls } = makeStubClient();
		const body = {} as RenameMailboxInput;

		await applyMailboxPatch(
			client,
			ACCOUNT_CONFIG_ID,
			MAILBOX_ID,
			ACCOUNT_ID,
			body,
		);

		assert.equal(calls.upsert.length, 0);
		assert.equal(calls.delete.length, 0);
		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.get, 1);
	});
});
