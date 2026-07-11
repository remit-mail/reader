import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import {
	guardConnectionCursor,
	guardMailboxCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "./mailbox-cursor.js";
import type { IImapConnection, ImapBoxStatus } from "./types.js";

const mailboxId = "mbx-1";
const accountId = "acc-1";

const baseMailbox: Pick<MailboxItem, "mailboxId" | "uidValidity"> & {
	cursorState: MailboxItem["cursorState"] | undefined;
} = {
	mailboxId,
	uidValidity: 100,
	// A pre-migration row genuinely lacks this attribute at runtime despite the
	// type saying it's total — see mailbox-cursor.ts for why `undefined` is
	// accepted here.
	cursorState: undefined,
};

describe("guardMailboxCursor", () => {
	it("is ok and writes nothing when the served UIDVALIDITY matches the stored value", async () => {
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = {
			update,
		} as unknown as Pick<IMailboxRepository, "update">;

		const result = await guardMailboxCursor(
			{ mailboxService },
			accountId,
			baseMailbox,
			100,
		);

		assert.deepEqual(result, { ok: true });
		assert.equal(update.mock.calls.length, 0);
	});

	it("treats an absent cursorState as normal", async () => {
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const result = await guardMailboxCursor(
			{ mailboxService },
			accountId,
			{ ...baseMailbox, cursorState: undefined },
			100,
		);

		assert.deepEqual(result, { ok: true });
	});

	it("trips cursor_invalid and persists it when the served UIDVALIDITY disagrees", async () => {
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const result = await guardMailboxCursor(
			{ mailboxService },
			accountId,
			{ ...baseMailbox, uidValidity: 100 },
			200,
		);

		assert.deepEqual(result, { ok: false, state: "cursor_invalid" });
		assert.equal(update.mock.calls.length, 1);
		assert.deepEqual(update.mock.calls[0].arguments, [
			accountId,
			mailboxId,
			{ cursorState: MailboxCursorState.cursor_invalid },
		]);
	});

	it("short-circuits without a write when already cursor_invalid, even if UIDVALIDITY now matches", async () => {
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const result = await guardMailboxCursor(
			{ mailboxService },
			accountId,
			{ ...baseMailbox, cursorState: MailboxCursorState.cursor_invalid },
			100,
		);

		assert.deepEqual(result, { ok: false, state: "cursor_invalid" });
		assert.equal(
			update.mock.calls.length,
			0,
			"paused mailboxes must not be re-tripped on every call (frugal — invariant 6)",
		);
	});

	it("short-circuits without a write when rebuilding", async () => {
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const result = await guardMailboxCursor(
			{ mailboxService },
			accountId,
			{ ...baseMailbox, cursorState: MailboxCursorState.rebuilding },
			999,
		);

		assert.deepEqual(result, { ok: false, state: "rebuilding" });
		assert.equal(update.mock.calls.length, 0);
	});
});

describe("guardConnectionCursor", () => {
	const fakeBoxStatus = (uidvalidity: number): ImapBoxStatus =>
		({
			uidvalidity,
		}) as unknown as ImapBoxStatus;

	it("delegates to the real openBox and returns normally when normal and matching", async () => {
		const openBox = mock.fn(async () => fakeBoxStatus(100));
		const connection = { openBox } as unknown as IImapConnection;
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const guarded = guardConnectionCursor(
			connection,
			{ mailboxService },
			accountId,
			{ ...baseMailbox, uidValidity: 100 },
		);

		const result = await guarded.openBox("INBOX", false);

		assert.deepEqual(result, fakeBoxStatus(100));
		assert.equal(openBox.mock.calls.length, 1);
		assert.equal(update.mock.calls.length, 0);
	});

	it("throws MailboxCursorPausedError and never calls the real openBox when already paused", async () => {
		const openBox = mock.fn(async () => fakeBoxStatus(100));
		const connection = { openBox } as unknown as IImapConnection;
		const mailboxService = {
			update: mock.fn(async () => ({}) as MailboxItem),
		} as unknown as Pick<IMailboxRepository, "update">;

		const guarded = guardConnectionCursor(
			connection,
			{ mailboxService },
			accountId,
			{ ...baseMailbox, cursorState: MailboxCursorState.cursor_invalid },
		);

		await assert.rejects(
			() => guarded.openBox("INBOX"),
			(err: unknown) =>
				err instanceof MailboxCursorPausedError &&
				err.state === "cursor_invalid",
		);
		assert.equal(
			openBox.mock.calls.length,
			0,
			"a mailbox already known paused must not touch the network (frugal — invariant 6)",
		);
	});

	it("trips and throws MailboxCursorPausedError when the served UIDVALIDITY disagrees", async () => {
		const openBox = mock.fn(async () => fakeBoxStatus(200));
		const connection = { openBox } as unknown as IImapConnection;
		const update = mock.fn(async () => ({}) as MailboxItem);
		const mailboxService = { update } as unknown as Pick<
			IMailboxRepository,
			"update"
		>;

		const guarded = guardConnectionCursor(
			connection,
			{ mailboxService },
			accountId,
			{ ...baseMailbox, uidValidity: 100 },
		);

		await assert.rejects(
			() => guarded.openBox("INBOX"),
			(err: unknown) =>
				err instanceof MailboxCursorPausedError &&
				err.state === "cursor_invalid",
		);
		assert.equal(
			openBox.mock.calls.length,
			1,
			"the real openBox must run once to learn the served UIDVALIDITY",
		);
		assert.equal(
			update.mock.calls.length,
			1,
			"the mismatch must trip the mailbox",
		);
	});

	it("passes other methods through untouched (e.g. fetchMessages)", async () => {
		const fetchMessages = mock.fn(async () => []);
		const connection = {
			openBox: async () => fakeBoxStatus(100),
			fetchMessages,
		} as unknown as IImapConnection;

		const guarded = guardConnectionCursor(
			connection,
			{ mailboxService: { update: async () => ({}) as MailboxItem } },
			accountId,
			{ ...baseMailbox, uidValidity: 100 },
		);

		await guarded.fetchMessages([1, 2, 3]);
		assert.equal(fetchMessages.mock.calls.length, 1);
		assert.deepEqual(fetchMessages.mock.calls[0].arguments, [[1, 2, 3]]);
	});
});

describe("isCursorRebuildNeeded", () => {
	it("is false for undefined and normal", () => {
		assert.equal(isCursorRebuildNeeded(undefined), false);
		assert.equal(isCursorRebuildNeeded(MailboxCursorState.normal), false);
	});

	it("is true for cursor_invalid and rebuilding", () => {
		assert.equal(
			isCursorRebuildNeeded(MailboxCursorState.cursor_invalid),
			true,
		);
		assert.equal(isCursorRebuildNeeded(MailboxCursorState.rebuilding), true);
	});
});
