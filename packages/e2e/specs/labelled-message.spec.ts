/**
 * A message that lives in two real folders stays in the Inbox (#1146).
 *
 * A Gmail user label, a Sieve `fileinto` beside a `keep`, and a Sent copy a
 * mailing list echoes back all leave the same RFC 5322 Message-ID in two of an
 * account's folders. Sync resolves both sightings to one row, and reading the
 * second folder's sighting as a move took the mail out of the Inbox on whichever
 * round enumerated the label. Dovecot reproduces the shape exactly: APPEND the
 * same message twice, to INBOX and to a folder beside it.
 *
 * Seeded in the order a label is really applied — the mail arrives, syncs, and
 * is labelled after — so which folder the row starts in is established rather
 * than left to the order the fan-out happens to sync folders in.
 *
 * Its own throwaway user: the spec creates a folder and seeds the same message
 * into two places, neither of which may leak into the shared account.
 */
import { type AccountSyncStatus, ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, listServerSubjects } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const LABEL_PATH = `Receipts ${STAMP}`;
const SUBJECT = `Labelled and in the inbox ${STAMP}`;
const MESSAGE_ID = `<labelled-${STAMP}@remit.test>`;

const lastSyncedAt = (status: AccountSyncStatus, fullPath: string): number =>
	status.mailboxes.find((mailbox) => mailbox.fullPath === fullPath)
		?.lastSyncedAt ?? 0;

/**
 * Sync until the label folder's own message-sync round has run again.
 *
 * The re-point this spec is about happens while that folder is being
 * enumerated, so the Inbox listing only answers for anything once it has run.
 * `lastSyncedAt` moves on every round for a folder, empty ones included, which
 * makes an advance of it the exact barrier; and the trigger is re-issued rather
 * than issued once, because a trigger that arrives while a round is already
 * running is discarded as a duplicate (#37).
 */
const syncPastTheLabel = async (
	api: ApiClient,
	accountId: string,
): Promise<void> => {
	const cursor = lastSyncedAt(await api.getSyncStatus(accountId), LABEL_PATH);
	const deadline = Date.now() + 120_000;

	while (Date.now() < deadline) {
		await api.triggerSync(accountId).catch(() => undefined);
		const advanced = await waitFor(
			() => api.getSyncStatus(accountId),
			(status) => lastSyncedAt(status, LABEL_PATH) > cursor,
			{
				timeoutMs: 20_000,
				intervalMs: 1_000,
				what: `a message-sync round over "${LABEL_PATH}"`,
			},
		).then(
			() => true,
			() => false,
		);
		if (advanced) return;
	}

	throw new Error(
		`"${LABEL_PATH}" ran no message-sync round within 120000ms of being asked`,
	);
};

test.describe("A message in two folders at once", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	// Set inside the hook, which is what `test.setTimeout` extends when called
	// from one: sign-up, an account connect, a folder create and two APPENDs run
	// here, each behind a sync the deployment has to get to.
	test.beforeAll(async () => {
		test.setTimeout(240_000);

		run = await provisionIsolatedRun("E2E Labelled Message");
		api = new ApiClient(run);

		// The mail arrives first and the row settles on the Inbox, exactly as it
		// would before anyone labels anything.
		await appendMessages(run.imapUser, [
			{
				subject: SUBJECT,
				messageIdHeader: MESSAGE_ID,
				body: `Body of ${SUBJECT}.`,
			},
		]);
		await api.triggerSync(run.accountId);
		await api.messageIdForSubject(run.inboxId, SUBJECT);

		// Then the label: the folder through the API, so the spec never waits on
		// folder discovery, and the second copy straight onto the server, which is
		// what a label or a `fileinto` leaves behind.
		await api.createSettledMailbox(run.accountId, LABEL_PATH);
		await appendMessages(
			run.imapUser,
			[
				{
					subject: SUBJECT,
					messageIdHeader: MESSAGE_ID,
					body: `Body of ${SUBJECT}.`,
				},
			],
			LABEL_PATH,
		);
	});

	test("stays in the inbox after the folder beside it has synced", async () => {
		test.setTimeout(300_000);

		// Both copies are on the server, and both stay there: nothing in this
		// spec asks for a mutation, so a listing that loses the message lost it
		// to reader's own re-point rather than to anything Dovecot did.
		expect(await listServerSubjects(run.imapUser, "INBOX")).toContain(SUBJECT);
		expect(await listServerSubjects(run.imapUser, LABEL_PATH)).toContain(
			SUBJECT,
		);

		await syncPastTheLabel(api, run.accountId);

		const afterLabel = await api.listThreads(run.inboxId);
		expect(afterLabel.map((thread) => thread.subject)).toContain(SUBJECT);

		// "The next sync": a second round over the label folder, which is where
		// the re-point was reported.
		await syncPastTheLabel(api, run.accountId);

		const afterNextSync = await api.listThreads(run.inboxId);
		expect(afterNextSync.map((thread) => thread.subject)).toContain(SUBJECT);

		expect(await listServerSubjects(run.imapUser, "INBOX")).toContain(SUBJECT);
		expect(await listServerSubjects(run.imapUser, LABEL_PATH)).toContain(
			SUBJECT,
		);
	});
});
