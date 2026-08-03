/**
 * A move whose destination is the mailbox the message is already in must not
 * reach the mail server.
 *
 * IMAP has no in-place MOVE. The server copies the message, expunges the
 * original and issues a fresh UID, so such a request destroys the message's
 * identity on the user's real mailbox to arrive at the state it was already in.
 * It is reachable in practice: pressing a move action twice sends the second
 * request after the first has landed, and the second names the mailbox the
 * message just arrived in.
 *
 * The assertion is the UID Dovecot holds, not what the API reports — the API
 * would read the same either way.
 *
 * Nothing here changes what the run's mailboxes hold. The message under test is
 * untouched by design, and the second message, which only serves as a barrier,
 * is put back where it was found before anything is asserted.
 */
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { listServerSubjects, serverUidsForSubject } from "../src/imap.js";

test.describe("Same-mailbox move", () => {
	test("does not touch the message on the mail server", async ({
		api,
		run,
	}) => {
		const mailboxes = await api.listMailboxes(run.accountId);
		const junk = mailboxes.find((mailbox) => mailbox.fullPath === "Junk");
		if (!junk) throw new Error("the run's Junk mailbox has not synced");

		const targetSubject = run.conversation.receivedSubject;
		// Any other seeded INBOX message: the ones other specs pin by star or by
		// classified category are left out, so a round trip through Junk cannot
		// perturb what they assert.
		const barrierSubject = run.seededSubjects.find(
			(subject) =>
				subject !== targetSubject &&
				subject !== run.preFlaggedSubject &&
				!run.classificationExpectations.some(
					(expectation) => expectation.subject === subject,
				),
		);
		if (!barrierSubject) throw new Error("no spare seeded INBOX message");

		const threads = await api.listThreads(run.inboxId);
		const target = threads.find((thread) => thread.subject === targetSubject);
		const barrier = threads.find((thread) => thread.subject === barrierSubject);
		if (!target || !barrier) {
			throw new Error("the seeded INBOX messages have not synced");
		}

		const uidsBefore = await serverUidsForSubject(
			run.imapUser,
			"INBOX",
			targetSubject,
		);
		expect(uidsBefore).toHaveLength(1);

		await api.moveMessages([target.messageId], run.inboxId);

		// Both moves ride the same per-account FIFO group, so a move enqueued
		// after the one under test cannot be applied before it. Once the barrier
		// is on the server, the move under test has had its turn — and either
		// took it or was never enqueued. That is what makes the assertion below
		// an observation rather than a wait long enough to look convincing.
		await api.moveMessages([barrier.messageId], junk.mailboxId);
		await waitFor(
			() => listServerSubjects(run.imapUser, "Junk"),
			(subjects) => subjects.includes(barrierSubject),
			{ timeoutMs: 30_000, what: `"${barrierSubject}" to reach Junk` },
		);

		await api.moveMessages([barrier.messageId], run.inboxId);
		await waitFor(
			() => listServerSubjects(run.imapUser, "INBOX"),
			(subjects) => subjects.includes(barrierSubject),
			{ timeoutMs: 30_000, what: `"${barrierSubject}" to return to INBOX` },
		);

		const uidsAfter = await serverUidsForSubject(
			run.imapUser,
			"INBOX",
			targetSubject,
		);
		expect(uidsAfter).toEqual(uidsBefore);
	});
});
