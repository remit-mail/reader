import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import {
	guardConnectionCursor,
	guardMailboxCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "./mailbox-cursor.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	imap.addFolder("INBOX", { uidValidity: 100 });
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX", {
		overrides: { uidValidity: 100 },
	});
});

afterEach(() => store.close());

const stored = () => store.mailbox.get(account.accountId, inbox.mailboxId);

const pause = (cursorState: MailboxItem["cursorState"]) =>
	store.mailbox.update(account.accountId, inbox.mailboxId, { cursorState });

const guard = async (served: number) =>
	guardMailboxCursor(
		{ mailboxService: store.mailbox },
		account.accountId,
		await stored(),
		served,
	);

describe("guardMailboxCursor", () => {
	it("passes a mailbox whose served UIDVALIDITY matches", async () => {
		assert.deepEqual(await guard(100), { ok: true });
		assert.equal((await stored()).cursorState, MailboxCursorState.normal);
	});

	it("trips and persists cursor_invalid when the served UIDVALIDITY disagrees", async () => {
		assert.deepEqual(await guard(200), { ok: false, state: "cursor_invalid" });
		assert.equal(
			(await stored()).cursorState,
			MailboxCursorState.cursor_invalid,
		);
	});

	for (const state of [
		MailboxCursorState.cursor_invalid,
		MailboxCursorState.rebuilding,
	]) {
		it(`stays paused while ${state}, whatever the server serves`, async () => {
			await pause(state);

			assert.deepEqual(await guard(100), { ok: false, state });
			assert.equal((await stored()).cursorState, state);
		});
	}
});

describe("guardConnectionCursor", () => {
	const guarded = async () =>
		guardConnectionCursor(
			imap.connection(),
			{ mailboxService: store.mailbox },
			account.accountId,
			await stored(),
		);

	it("opens the box and passes other calls through when the cursor holds", async () => {
		imap.deliver("INBOX", eml({}));
		const connection = await guarded();

		const box = await connection.openBox("INBOX");
		const rows = await connection.fetchMessages([1]);

		assert.equal(box.uidvalidity, 100);
		assert.deepEqual(
			rows.map((row) => row.uid),
			[1],
		);
	});

	it("refuses to open a mailbox already paused", async () => {
		await pause(MailboxCursorState.cursor_invalid);
		const connection = await guarded();

		await assert.rejects(
			connection.openBox("INBOX"),
			(err: unknown) =>
				err instanceof MailboxCursorPausedError &&
				err.state === "cursor_invalid",
		);
	});

	it("trips the mailbox and refuses when the server renumbered it", async () => {
		const connection = await guarded();
		imap.renumber("INBOX", 200);

		await assert.rejects(
			connection.openBox("INBOX"),
			(err: unknown) =>
				err instanceof MailboxCursorPausedError &&
				err.state === "cursor_invalid",
		);
		assert.equal(
			(await stored()).cursorState,
			MailboxCursorState.cursor_invalid,
		);
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
