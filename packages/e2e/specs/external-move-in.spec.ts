import { ApiClient } from "../src/api.js";
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
		await api.syncPastMailbox(run.accountId, FOLDER_PATH);
		await api.messageIdForSubject(folderId, RESIDENT_SUBJECT);
		await api.syncPastMailbox(run.accountId, FOLDER_PATH);
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

		await api.syncPastMailbox(run.accountId, FOLDER_PATH);
		await api.syncPastMailbox(run.accountId, FOLDER_PATH);

		const inFolder = (await api.listThreads(folderId)).filter(
			(thread) => thread.subject === MOVED_SUBJECT,
		);
		expect(inFolder.map((thread) => thread.messageId)).toEqual([
			movedMessageId,
		]);
		expect(await subjectsIn(api, run.inboxId)).not.toContain(MOVED_SUBJECT);
	});
});
