/**
 * Deleting a folder, measured on the mail server and on the folder's own mail.
 *
 * `delete-folder.spec.ts` drives the wizard; this asserts what the wizard's
 * confirm has to produce. Both halves are read from Dovecot and from the API,
 * because the two defects this closes were invisible from the read model
 * alone: the folder's `message` rows survived a delete keyed to a dead
 * mailboxId — out of every reader and still in the search index — and a
 * `deleting` row was hidden from the listing, so a delete that did not settle
 * looked like a folder that silently vanished while the server still held it.
 *
 * The refusal is measured the same way. Its whole claim is that nothing
 * happened, and a read model that never wrote is no evidence of that: the
 * folder is still on the server afterwards, and the filter bound to it still
 * exists.
 *
 * Runs as its own throwaway user (see `src/provision.ts`). Mailbox management
 * and SYNC_MAILBOXES share one FIFO group per account, so a delete queued
 * behind the shared account's own sync traffic can take longer than the
 * assertion's window to reach the worker (#347).
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	listServerMailboxes,
	listServerSubjects,
	setServerMailboxOwnerRights,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();

test.describe("Deleting a folder", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Delete Folder Server Truth");
		api = new ApiClient(run);
	});

	test("takes the folder's mail with it, off the server and out of the account", async () => {
		test.setTimeout(240_000);

		const path = `Bonnen ${STAMP}`;
		const subject = `Delete takes the mail ${STAMP}`;

		const folder = await api.createSettledMailbox(run.accountId, path);
		await appendMessages(run.imapUser, [{ subject }], path);
		await api.triggerSync(run.accountId);

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				list.some(
					(box) => box.mailboxId === folder.mailboxId && box.messageCount === 1,
				),
			{ timeoutMs: 120_000, what: `"${path}" to hold its message` },
		);
		expect((await api.listThreads(folder.mailboxId)).length).toBeGreaterThan(0);
		await waitFor(
			() => api.listAllThreads({ query: subject, accountId: run.accountId }),
			(threads) => threads.some((thread) => thread.subject === subject),
			{ timeoutMs: 120_000, what: `a search to find "${subject}"` },
		);

		const response = await api.deleteMailbox(run.accountId, folder.mailboxId);
		expect(response.status).toBe(204);

		// The row stays, marked, until the mail server confirms (D11). Hiding it
		// is what made a stuck delete look like a folder that vanished.
		const recorded = await api.listMailboxes(run.accountId);
		const marked = recorded.find((box) => box.mailboxId === folder.mailboxId);
		if (marked) expect(marked.syncStatus).toBe("deleting");

		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => !paths.includes(path),
			{ timeoutMs: 120_000, what: `Dovecot to drop "${path}"` },
		);

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => !list.some((box) => box.mailboxId === folder.mailboxId),
			{ timeoutMs: 120_000, what: "the folder row to go with it" },
		);

		// The mail went with the folder rather than being orphaned under a dead
		// mailboxId, where it stayed searchable forever (D8).
		expect(await api.listThreads(folder.mailboxId)).toHaveLength(0);
		expect(
			await api.listAllThreads({ query: subject, accountId: run.accountId }),
		).toHaveLength(0);
	});

	test("refuses while a filter is bound to it, and leaves both standing", async () => {
		test.setTimeout(240_000);

		const path = `Facturen ${STAMP}`;
		const folder = await api.createSettledMailbox(run.accountId, path);
		const filter = await api.createFilter(run.accountId, {
			name: `Invoices ${STAMP}`,
			scope: "Standing",
			literalClauses: [{ field: "Subject", value: "invoice" }],
			actionMailboxId: folder.mailboxId,
		});

		const response = await api.deleteMailbox(run.accountId, folder.mailboxId);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain(`Invoices ${STAMP}`);

		// Nothing happened, on either side of the binding.
		expect(await listServerMailboxes(run.imapUser)).toContain(path);
		const filters = await api.listFilters(run.accountId);
		expect(
			filters.find((row) => row.filterId === filter.filterId)?.actionMailboxId,
		).toBe(folder.mailboxId);

		// Unbind it, and the same request goes through.
		await api.deleteFilter(run.accountId, filter.filterId);
		expect(
			(await api.deleteMailbox(run.accountId, folder.mailboxId)).status,
		).toBe(204);
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => !paths.includes(path),
			{ timeoutMs: 120_000, what: `Dovecot to drop "${path}"` },
		);
	});

	test("keeps a folder the server refused to delete, with its mail, until a retry", async () => {
		test.setTimeout(240_000);

		const path = `Locked ${STAMP}`;
		const subject = `Refused delete keeps the mail ${STAMP}`;

		const folder = await api.createSettledMailbox(run.accountId, path);
		await appendMessages(run.imapUser, [{ subject }], path);
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.listThreads(folder.mailboxId),
			(threads) => threads.length > 0,
			{ timeoutMs: 120_000, what: `"${path}" to hold its message locally` },
		);

		await setServerMailboxOwnerRights(run.imapUser, path, "lrwstipeka");

		const refused = await api.deleteMailbox(run.accountId, folder.mailboxId);
		expect(refused.status).toBe(204);

		const failed = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				list.some(
					(box) =>
						box.mailboxId === folder.mailboxId && box.syncStatus === "failed",
				),
			{ timeoutMs: 120_000, what: `"${path}" to report the refused delete` },
		);
		const row = failed.find((box) => box.mailboxId === folder.mailboxId);
		expect(row?.fullPath).toBe(path);
		expect(row?.pendingPath).toBeUndefined();

		expect(await listServerMailboxes(run.imapUser)).toContain(path);
		expect(await listServerSubjects(run.imapUser, path)).toContain(subject);
		expect((await api.listThreads(folder.mailboxId)).length).toBeGreaterThan(0);

		await setServerMailboxOwnerRights(run.imapUser, path, "lrwstipekxa");

		const retried = await api.deleteMailbox(run.accountId, folder.mailboxId);
		expect(retried.status).toBe(204);

		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => !paths.includes(path),
			{ timeoutMs: 120_000, what: `Dovecot to drop "${path}" on the retry` },
		);
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => !list.some((box) => box.mailboxId === folder.mailboxId),
			{ timeoutMs: 120_000, what: "the folder row to go with it" },
		);
		expect(await api.listThreads(folder.mailboxId)).toHaveLength(0);
	});
});
