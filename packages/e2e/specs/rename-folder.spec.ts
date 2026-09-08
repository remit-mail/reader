/**
 * Renaming a folder, measured on the mail server.
 *
 * The whole design turns on the row never claiming a path Dovecot does not
 * hold (`folder-rename-and-delete.md` D2), so a read model asserting its own
 * write proves nothing here: the bug this replaces was precisely a row and a
 * server that disagreed. Both ends are read — Dovecot's own LIST, and the
 * folder listing the client sees.
 *
 * The second test is the D14 sweep guard, which only becomes reachable once a
 * rename records a target instead of a path. Between Dovecot executing RENAME
 * and the settle writing back, LIST returns a path no row is keyed to; the
 * sweep's insert branch has no state guard of its own, so without that guard it
 * inserts a second row under a fresh mailboxId and initial-syncs the folder's
 * mail into it — leaving the original as a permanent phantom still holding
 * every message, filter and role appointment bound to it. The proof is the
 * mailboxId surviving the rename, with no second row for the new path.
 *
 * Runs as its own throwaway user (see `src/provision.ts`). Mailbox management
 * and SYNC_MAILBOXES share one FIFO group per account, so a rename queued
 * behind the shared account's sync traffic can take longer than the assertion's
 * window to reach the worker (#347).
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, listServerMailboxes } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();

test.describe("Renaming a folder", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Rename Folder");
		api = new ApiClient(run);
	});

	test("moves the folder and its subfolder on the server, and settles both rows", async () => {
		test.setTimeout(240_000);

		const parentPath = `Work ${STAMP}`;
		const childPath = `${parentPath}/2026`;
		const parent = await api.createSettledMailbox(run.accountId, parentPath);
		const child = await api.createSettledMailbox(run.accountId, childPath);

		const renamedParent = `Projects ${STAMP}`;
		const renamedChild = `${renamedParent}/2026`;

		const recorded = await api.renameMailbox(
			run.accountId,
			parent.mailboxId,
			renamedParent,
		);

		// The intent, not the move: the row still names the path the server holds.
		expect(recorded.fullPath).toBe(parentPath);
		expect(recorded.pendingPath).toBe(renamedParent);

		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => paths.includes(renamedParent) && paths.includes(renamedChild),
			{
				timeoutMs: 120_000,
				what: `Dovecot to hold "${renamedParent}" and "${renamedChild}"`,
			},
		);
		expect(await listServerMailboxes(run.imapUser)).not.toContain(parentPath);

		const settled = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				list.some(
					(box) =>
						box.mailboxId === parent.mailboxId &&
						box.fullPath === renamedParent &&
						box.syncStatus === "synced",
				) &&
				list.some(
					(box) =>
						box.mailboxId === child.mailboxId &&
						box.fullPath === renamedChild &&
						box.syncStatus === "synced",
				),
			{ timeoutMs: 120_000, what: "both rows to settle on the renamed paths" },
		);

		// The subtree moved on the same ids, so nothing bound to either folder is
		// left pointing at a row that no longer exists.
		for (const box of settled) {
			if (box.mailboxId === parent.mailboxId) {
				expect(box.pendingPath).toBeUndefined();
			}
		}
	});

	test("keeps the folder's mail on the same row, with no second row for the new path", async () => {
		test.setTimeout(240_000);

		const before = `Receipts ${STAMP}`;
		const after = `Bonnen ${STAMP}`;
		const subject = `Rename keeps the mail ${STAMP}`;

		const folder = await api.createSettledMailbox(run.accountId, before);
		await appendMessages(run.imapUser, [{ subject }], before);
		await api.triggerSync(run.accountId);

		const withMail = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				list.some(
					(box) => box.mailboxId === folder.mailboxId && box.messageCount === 1,
				),
			{ timeoutMs: 120_000, what: `"${before}" to hold its message` },
		);
		expect(
			withMail.find((box) => box.mailboxId === folder.mailboxId)?.messageCount,
		).toBe(1);

		await api.renameMailbox(run.accountId, folder.mailboxId, after);
		// A sync round mid-rename is the window D14 closes: Dovecot may already
		// hold the new path while the settle has not written it back.
		await api.triggerSync(run.accountId);

		const settled = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				list.some(
					(box) =>
						box.mailboxId === folder.mailboxId &&
						box.fullPath === after &&
						box.syncStatus === "synced",
				),
			{ timeoutMs: 120_000, what: `"${after}" to settle on the same row` },
		);

		const atNewPath = settled.filter((box) => box.fullPath === after);
		expect(atNewPath).toHaveLength(1);
		expect(atNewPath[0]?.mailboxId).toBe(folder.mailboxId);
		expect(settled.some((box) => box.fullPath === before)).toBe(false);

		// The mail travelled with the row rather than being initial-synced into a
		// duplicate the sweep inserted.
		const threads = await api.listThreads(folder.mailboxId);
		expect(threads.length).toBeGreaterThan(0);
	});
});
