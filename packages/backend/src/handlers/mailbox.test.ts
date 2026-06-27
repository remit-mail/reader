import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailboxItem } from "@remit/remit-electrodb-service";
import type { RenameMailboxInput } from "@remit/api-openapi-types";
import {
	applyMailboxPatch,
	buildMailboxOverrideChanges,
	type MailboxPatchClient,
} from "./mailbox.js";

const MUTED_FLAG = {
	value: true,
	setAt: 1_700_000_000_000,
	setBy: "device-a",
};

describe("buildMailboxOverrideChanges", () => {
	it("returns empty update and remove when no override key is present (no-op)", () => {
		const body = { fullPath: "INBOX" } as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, {});
		assert.deepEqual(remove, []);
	});

	it("sets muted flag when a MutedFlag object is provided", () => {
		const body = { muted: MUTED_FLAG } as unknown as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, { muted: MUTED_FLAG });
		assert.deepEqual(remove, []);
	});

	it("signals removal when muted is null", () => {
		const body = { muted: null } as unknown as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, {});
		assert.deepEqual(remove, ["muted"]);
	});

	it("sets displayNameOverride when a string is provided", () => {
		const body = {
			displayNameOverride: "Work Stuff",
		} as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, { displayNameOverride: "Work Stuff" });
		assert.deepEqual(remove, []);
	});

	it("signals removal when displayNameOverride is null", () => {
		const body = {
			displayNameOverride: null,
		} as unknown as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, {});
		assert.deepEqual(remove, ["displayNameOverride"]);
	});

	it("sets roleOverride when a MailboxRole is provided", () => {
		const body = { roleOverride: "Archive" } as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, { roleOverride: "Archive" });
		assert.deepEqual(remove, []);
	});

	it("signals removal when roleOverride is null", () => {
		const body = { roleOverride: null } as unknown as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, {});
		assert.deepEqual(remove, ["roleOverride"]);
	});

	it("combines set and clear across override fields", () => {
		const body = {
			displayNameOverride: "Receipts",
			roleOverride: null,
			muted: MUTED_FLAG,
		} as unknown as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		assert.deepEqual(updates, {
			displayNameOverride: "Receipts",
			muted: MUTED_FLAG,
		});
		assert.deepEqual(remove, ["roleOverride"]);
	});

	it("does not signal rename machinery (fullPath unchanged) for an override-only PATCH", () => {
		// The handler only calls renameMailbox when fullPath is present.
		// An override-only body without fullPath should produce override changes
		// but no rename signal. Verified by asserting fullPath is not in updates.
		const body = { muted: MUTED_FLAG } as unknown as RenameMailboxInput;
		const { updates } = buildMailboxOverrideChanges(body);
		assert.ok(
			!Object.prototype.hasOwnProperty.call(updates, "fullPath"),
			"fullPath must not appear in override updates",
		);
	});

	it("treats an override key set to undefined the same as absent (no-op)", () => {
		// Destructuring a missing key yields undefined; should be a no-op.
		const body = { muted: undefined } as RenameMailboxInput;
		const { updates, remove } = buildMailboxOverrideChanges(body);
		// key is present but undefined → still iterated, but neither set nor
		// remove should fire.
		assert.deepEqual(updates, {});
		assert.deepEqual(remove, []);
	});
});

// ── Handler-level tests for the no-rename guarantee ──────────────────
// The spec's acceptance criterion: a mute-only PATCH "sets and clears the
// mailbox mute without touching the rename/sync-status machinery". These
// tests pin that at the handler level by stubbing the client and asserting
// mailboxQueue.renameMailbox is (not) invoked.

const MAILBOX_ID = "mb-1";
const ACCOUNT_ID = "acc-1";

const makeStubClient = () => {
	const calls = {
		update: [] as unknown[][],
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
			update: async (mailboxId, input, remove) => {
				calls.update.push([mailboxId, input, remove]);
				return item;
			},
		},
		mailboxQueue: {
			renameMailbox: async (mailboxId, newPath, accountId) => {
				calls.renameMailbox.push([mailboxId, newPath, accountId]);
				return item;
			},
		},
	};
	return { client, calls, item };
};

describe("applyMailboxPatch", () => {
	it("mute-only PATCH (set) never calls mailboxQueue.renameMailbox", async () => {
		const { client, calls } = makeStubClient();
		const body = { muted: MUTED_FLAG } as unknown as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.update.length, 1);
		assert.deepEqual(calls.update[0], [
			MAILBOX_ID,
			{ muted: MUTED_FLAG },
			undefined,
		]);
		assert.equal(calls.get, 1, "responds with a fresh get, not a rename");
	});

	it("mute-only PATCH (clear via null) never calls mailboxQueue.renameMailbox", async () => {
		const { client, calls } = makeStubClient();
		const body = { muted: null } as unknown as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.update.length, 1);
		assert.deepEqual(calls.update[0], [MAILBOX_ID, {}, ["muted"]]);
	});

	it("PATCH with fullPath calls mailboxQueue.renameMailbox", async () => {
		const { client, calls } = makeStubClient();
		const body = { fullPath: "Archive/2026" } as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.deepEqual(calls.renameMailbox, [
			[MAILBOX_ID, "Archive/2026", ACCOUNT_ID],
		]);
		assert.equal(calls.update.length, 0, "no direct mute update");
	});

	it("combined PATCH applies the mute update and then renames", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			fullPath: "Archive/2026",
			muted: MUTED_FLAG,
		} as unknown as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.update.length, 1);
		assert.deepEqual(calls.renameMailbox, [
			[MAILBOX_ID, "Archive/2026", ACCOUNT_ID],
		]);
	});

	it("override-only PATCH (display name + role) never calls mailboxQueue.renameMailbox", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			displayNameOverride: "Receipts",
			roleOverride: "Archive",
		} as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.update.length, 1);
		assert.deepEqual(calls.update[0], [
			MAILBOX_ID,
			{ displayNameOverride: "Receipts", roleOverride: "Archive" },
			undefined,
		]);
		assert.equal(calls.get, 1, "responds with a fresh get, not a rename");
	});

	it("override-only PATCH (clear both via null) removes the attributes", async () => {
		const { client, calls } = makeStubClient();
		const body = {
			displayNameOverride: null,
			roleOverride: null,
		} as unknown as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.update.length, 1);
		assert.deepEqual(calls.update[0], [
			MAILBOX_ID,
			{},
			["displayNameOverride", "roleOverride"],
		]);
	});

	it("empty PATCH body is a no-op: no update, no rename", async () => {
		const { client, calls } = makeStubClient();
		const body = {} as RenameMailboxInput;

		await applyMailboxPatch(client, MAILBOX_ID, ACCOUNT_ID, body);

		assert.equal(calls.update.length, 0);
		assert.equal(calls.renameMailbox.length, 0);
		assert.equal(calls.get, 1);
	});
});
