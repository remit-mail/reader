/**
 * A message that lives in two real folders stays in the Inbox (#1146).
 *
 * A Gmail user label, a Sieve `fileinto` beside a `keep`, and a Sent copy a
 * mailing list echoes back all leave the same RFC 5322 Message-ID in two of an
 * account's folders. Sync resolves both sightings to one row, and reading the
 * second folder's sighting as a move took the mail out of the Inbox on whichever
 * round enumerated the label last. Dovecot reproduces the shape exactly: append
 * the same message twice, to INBOX and to a folder beside it.
 *
 * Its own throwaway user: the spec creates a folder and seeds the same message
 * into two places, neither of which may leak into the shared account.
 */
import { type AccountSyncStatus, ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	createServerMailbox,
	listServerSubjects,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const LABEL_PATH = `Receipts ${STAMP}`;
const SUBJECT = `Labelled and in the inbox ${STAMP}`;
const MESSAGE_ID = `<labelled-${STAMP}@remit.test>`;

const lastSyncedAt = (status: AccountSyncStatus, fullPath: string): number =>
	status.mailboxes.find((mailbox) => mailbox.fullPath === fullPath)
		?.lastSyncedAt ?? 0;

/**
 * Trigger a sync and wait for the label folder's own message-sync round to
 * finish. The re-point this spec is about happens while that folder is being
 * enumerated, so the Inbox listing only answers for anything once it has run —
 * and `lastSyncedAt` moves on every round for a folder, empty ones included.
 */
const syncPastTheLabel = async (
	api: ApiClient,
	accountId: string,
): Promise<void> => {
	const cursor = lastSyncedAt(await api.getSyncStatus(accountId), LABEL_PATH);
	await api.triggerSync(accountId);
	await waitFor(
		() => api.getSyncStatus(accountId),
		(status) => lastSyncedAt(status, LABEL_PATH) > cursor,
		{
			timeoutMs: 60_000,
			intervalMs: 1_000,
			what: `a message-sync round over "${LABEL_PATH}"`,
		},
	);
};

test.describe("A message in two folders at once", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Labelled Message");
		api = new ApiClient(run);

		await createServerMailbox(run.imapUser, LABEL_PATH);
		for (const mailbox of ["INBOX", LABEL_PATH]) {
			await appendMessages(
				run.imapUser,
				[
					{
						subject: SUBJECT,
						messageIdHeader: MESSAGE_ID,
						body: `Body of ${SUBJECT}.`,
					},
				],
				mailbox,
			);
		}

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === LABEL_PATH),
			{ timeoutMs: 60_000, what: `"${LABEL_PATH}" to sync` },
		);
	});

	test("stays in the inbox after the folder beside it has synced", async () => {
		test.setTimeout(180_000);

		// Both copies are on the server, and both stay there: nothing in this
		// spec asks for a mutation, so a listing that loses the message lost it
		// to reader's own re-point rather than to anything Dovecot did.
		expect(await listServerSubjects(run.imapUser, "INBOX")).toContain(SUBJECT);
		expect(await listServerSubjects(run.imapUser, LABEL_PATH)).toContain(
			SUBJECT,
		);

		await syncPastTheLabel(api, run.accountId);
		await api.messageIdForSubject(run.inboxId, SUBJECT);

		// "The next sync": a second full round over the label folder, which is
		// where the re-point was observed.
		await syncPastTheLabel(api, run.accountId);

		const threads = await api.listThreads(run.inboxId);
		expect(threads.map((thread) => thread.subject)).toContain(SUBJECT);

		expect(await listServerSubjects(run.imapUser, "INBOX")).toContain(SUBJECT);
		expect(await listServerSubjects(run.imapUser, LABEL_PATH)).toContain(
			SUBJECT,
		);
	});
});
