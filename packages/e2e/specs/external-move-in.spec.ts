/**
 * A message another client moves into a folder reader already syncs
 * incrementally lands there, and only there (#1386).
 *
 * After its first full enumeration every folder syncs by CHANGEDSINCE, and that
 * round found the moved message's row by its Message-ID and applied flags to it
 * and nothing else. The row kept naming the folder the message had left, so the
 * mail stayed listed in the Inbox and never appeared where the other client put
 * it. Reader shares its mailboxes with Apple Mail and every other client, so this
 * is the ordinary way mail gets filed.
 *
 * The move is made straight on the server with IMAP MOVE, which is what another
 * client sends; nothing in the spec goes through reader's own move.
 *
 * Its own throwaway user: the spec creates a folder and moves a message out of
 * the Inbox, neither of which may leak into the shared account.
 */
import { type AccountSyncStatus, ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	listServerSubjects,
	moveServerMessage,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const FOLDER_PATH = `Filed ${STAMP}`;
const MOVED_SUBJECT = `Moved in by another client ${STAMP}`;
const RESIDENT_SUBJECT = `Already in the folder ${STAMP}`;

const lastSyncedAt = (status: AccountSyncStatus, fullPath: string): number =>
	status.mailboxes.find((mailbox) => mailbox.fullPath === fullPath)
		?.lastSyncedAt ?? 0;

/**
 * Sync until the folder's own message-sync round has run again. A trigger that
 * arrives while a round is already running is discarded as a duplicate (#37),
 * so it is re-issued until the folder's `lastSyncedAt` moves.
 */
const syncPastTheFolder = async (
	api: ApiClient,
	accountId: string,
): Promise<void> => {
	const cursor = lastSyncedAt(await api.getSyncStatus(accountId), FOLDER_PATH);
	const deadline = Date.now() + 120_000;

	while (Date.now() < deadline) {
		await api.triggerSync(accountId).catch(() => undefined);
		const advanced = await waitFor(
			() => api.getSyncStatus(accountId),
			(status) => lastSyncedAt(status, FOLDER_PATH) > cursor,
			{
				timeoutMs: 20_000,
				intervalMs: 1_000,
				what: `a message-sync round over "${FOLDER_PATH}"`,
			},
		).then(
			() => true,
			() => false,
		);
		if (advanced) return;
	}

	throw new Error(
		`"${FOLDER_PATH}" ran no message-sync round within 120000ms of being asked`,
	);
};

const subjectsIn = async (api: ApiClient, mailboxId: string) =>
	(await api.listThreads(mailboxId)).map((thread) => thread.subject);

test.describe("A move another client makes into a synced folder", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let folderId: string;
	let movedMessageId: string;

	test.beforeAll(async () => {
		test.setTimeout(300_000);

		run = await provisionIsolatedRun("E2E External Move In", [
			{ subject: MOVED_SUBJECT },
		]);
		api = new ApiClient(run);
		movedMessageId = await api.messageIdForSubject(run.inboxId, MOVED_SUBJECT);

		const folder = await api.createSettledMailbox(run.accountId, FOLDER_PATH);
		folderId = folder.mailboxId;
		await appendMessages(
			run.imapUser,
			[{ subject: RESIDENT_SUBJECT }],
			FOLDER_PATH,
		);

		// The round that enumerates the resident message seeds the folder's
		// mod-sequence; the round after it is a CHANGEDSINCE round. Both have run
		// before the move, so the move is seen by the incremental path only.
		await syncPastTheFolder(api, run.accountId);
		await api.messageIdForSubject(folderId, RESIDENT_SUBJECT);
		await syncPastTheFolder(api, run.accountId);
	});

	test("shows the message in the folder it was moved to and nowhere else", async () => {
		test.setTimeout(300_000);

		await moveServerMessage(run.imapUser, "INBOX", FOLDER_PATH, MOVED_SUBJECT);
		expect(await listServerSubjects(run.imapUser, "INBOX")).not.toContain(
			MOVED_SUBJECT,
		);
		expect(await listServerSubjects(run.imapUser, FOLDER_PATH)).toContain(
			MOVED_SUBJECT,
		);

		await syncPastTheFolder(api, run.accountId);
		await syncPastTheFolder(api, run.accountId);

		const inFolder = (await api.listThreads(folderId)).filter(
			(thread) => thread.subject === MOVED_SUBJECT,
		);
		expect(inFolder.map((thread) => thread.messageId)).toEqual([
			movedMessageId,
		]);
		expect(await subjectsIn(api, run.inboxId)).not.toContain(MOVED_SUBJECT);
	});
});
