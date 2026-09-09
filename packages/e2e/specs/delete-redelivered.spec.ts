/**
 * One delete, the event delivered twice, the message still in Trash with the
 * row that carries everything about it.
 *
 * MESSAGE_DELETE rides an at-least-once queue, so its acknowledgement can be
 * lost after the move to Trash has already landed. The redelivered handler then
 * MOVEs a uid the source no longer holds, fails every attempt, and its terminal
 * resolver reads the source's honest "gone" as grounds to delete the local rows
 * — which takes the message's spam report, its classification, its category and
 * the Undo target with it, none of which a resync can rebuild. The three
 * sibling handlers all recognise a finished piece of work before touching the
 * server; this pins that MESSAGE_DELETE does too.
 *
 * A redelivery is the queue's doing, not the app's, so nothing a user can press
 * produces one. The event is put back on `remit-messages.fifo` directly, with
 * the SOURCE uid the API recorded when it enqueued the original — the uid whose
 * staleness is the whole hazard.
 *
 * A second delete is pushed in behind it as the barrier. The account's
 * mutations are one FIFO group, so the barrier reaching Trash proves the
 * redelivery was handled rather than pending: everything after it reads settled
 * state. The barrier is per account rather than a drain of the shared queue,
 * which every other account in the run is also writing to.
 *
 * A throwaway user, never the shared fixture: this deletes mail, and every spec
 * that asserts the inbox holds exactly the seeded set would read that as a
 * missing row.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	listServerSubjects,
	serverUidsForSubject,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { enqueueMessageDelete } from "../src/queue.js";

/** Dovecot gives every maildir a `\Trash`-flagged `Trash`, at the root. */
const TRASH = "Trash";

const STAMP = Date.now();
const SUBJECT = `Redelivered delete ${STAMP}`;
const BARRIER_SUBJECT = `Redelivered delete barrier ${STAMP}`;

test.describe("A redelivered delete (#845)", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Redelivered Delete", [
			{ subject: SUBJECT, body: "Deleted once, the event delivered twice." },
			{ subject: BARRIER_SUBJECT, body: "Pushed in behind the redelivery." },
		]);
		api = new ApiClient(run);
	});

	test("keeps the message and its row when the delete event comes back", async () => {
		// Generous, because a build without the guard spends the redelivery's
		// whole attempt budget before the barrier behind it can move.
		test.setTimeout(600_000);

		const inbox = await waitFor(
			() => api.listThreads(run.inboxId),
			(threads) =>
				[SUBJECT, BARRIER_SUBJECT].every((subject) =>
					threads.some((thread) => thread.subject === subject),
				),
			{
				timeoutMs: 90_000,
				what: "both seeded messages to sync into the inbox",
			},
		);
		const idFor = (subject: string): string => {
			const thread = inbox.find((row) => row.subject === subject);
			if (!thread) throw new Error(`unreachable: "${subject}" was matched`);
			return thread.messageId;
		};
		const messageId = idFor(SUBJECT);

		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((mailbox) => mailbox.fullPath === TRASH),
			{ timeoutMs: 90_000, what: "the Trash folder to sync" },
		);
		const trash = mailboxes.find((mailbox) => mailbox.fullPath === TRASH);
		if (!trash) throw new Error("unreachable: Trash was matched but not found");

		// The uid the API records on the event it enqueues is the source folder's,
		// read before the move. Taking it here, while the message is still in
		// INBOX, is what makes the replayed event the one the queue would replay.
		const [sourceUid] = await serverUidsForSubject(
			run.imapUser,
			"INBOX",
			SUBJECT,
		);
		expect(sourceUid, "the seeded message is in INBOX with a uid").toBeTruthy();

		await api.deleteMessages([messageId]);
		await waitForServerMailbox(
			run.imapUser,
			TRASH,
			(subjects) => subjects.includes(SUBJECT),
			{ timeoutMs: 120_000, what: `"${SUBJECT}" to reach Trash` },
		);

		await enqueueMessageDelete({
			accountId: run.accountId,
			messageId,
			mailboxId: run.inboxId,
			mailboxPath: "INBOX",
			uid: sourceUid,
			destinationMailboxId: trash.mailboxId,
			destinationMailboxPath: TRASH,
		});

		await api.deleteMessages([idFor(BARRIER_SUBJECT)]);
		await waitForServerMailbox(
			run.imapUser,
			TRASH,
			(subjects) => subjects.includes(BARRIER_SUBJECT),
			{
				timeoutMs: 420_000,
				what: `"${BARRIER_SUBJECT}" to reach Trash behind the redelivery`,
			},
		);

		const trashSubjects = await listServerSubjects(run.imapUser, TRASH);
		expect(
			trashSubjects.filter((subject) => subject === SUBJECT),
			"the redelivery neither expunged the Trash copy nor made a second one",
		).toEqual([SUBJECT]);

		// `GET /messages/{id}`, not the Trash listing: every thread listing
		// hardcodes `excludeDeleted` (#212), so a row correctly marked deleted is
		// absent from it whether it exists or not. The Message row is what carries
		// the spam report, the classification, the category and the Undo target,
		// and reading it directly is what tells "still there" from "reconciled
		// away" — a redelivery that ran would have deleted it, and this 404s.
		const survived = await api.describeMessage(messageId);
		expect(
			survived.mailboxId,
			"the local row survives, still naming the folder the server has it in",
		).toBe(trash.mailboxId);
	});
});
