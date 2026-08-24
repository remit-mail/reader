/**
 * One send, the filing event delivered twice, one copy in Sent (#925 spec 6,
 * #858).
 *
 * The queue behind a send is at-least-once, so the event that files the Sent
 * copy can arrive again after it has already been handled. What makes the
 * second delivery harmless is a uid recorded on the outbox row before the row
 * is deleted — and by the time the send has settled, that row is gone, so the
 * redelivered handler has to recognise a finished piece of work from its
 * absence rather than from anything it left behind. Get that wrong and the user
 * has two copies of a message they sent once.
 *
 * A redelivery is the queue's doing, not the app's, so nothing a user can press
 * produces one. The event is put back on `remit-message-mgmt` directly, which
 * is the only reason this suite reaches the queue at all (`src/queue.ts`).
 *
 * The assertions are per subject, stamped with the moment the spec ran, because
 * the SMTP sink and the Sent folder are read by every send spec in the run.
 * Draining the queue proves the redelivery was handled rather than pending, and
 * the barrier send behind it proves anything it had wrongly enqueued ran first;
 * the dead-letter queue is read at the end because a redelivery that crashes
 * the worker is the same defect wearing a different face — the user's message
 * is filed, and the operator is paged for it.
 */

import { ApiClient, waitFor } from "../src/api.js";
import { drainWithBarrier } from "../src/barrier.js";
import { expect, test } from "../src/fixtures.js";
import { serverUidsForSubject } from "../src/imap.js";
import { waitForOutboxStatus } from "../src/outbox.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	enqueueAppendSentMessage,
	MESSAGE_MGMT_DLQ,
	MESSAGE_MGMT_QUEUE,
	readVisibleBodies,
	waitForQueueDrained,
} from "../src/queue.js";
import { countAcceptedMessages } from "../src/smtp-sink.js";

const RECIPIENT = "ada@remit.test";

const BODY = "Sent once, and the filing event delivered twice.";

test.describe("A redelivered filing event (#925)", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Redriven Append");
		api = new ApiClient(run);

		// Without a Sent folder the row settles `unfiled` instead of being deleted,
		// and this spec reads both the copy and the row's absence. Dovecot creates
		// the folder on first login, so this waits on the sync having seen it.
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
	});

	test("files no second copy when the append event comes back", async () => {
		test.setTimeout(300_000);

		const stamp = Date.now();
		const subject = `Redriven append ${stamp}`;
		const barrierSubject = `Redriven append barrier ${stamp}`;

		const { outboxMessageId } = await api.sendMessage({
			accountId: run.accountId,
			toAddresses: [RECIPIENT],
			subject,
			textBody: BODY,
		});

		// The row is deleted once the copy is filed, so a 404 is the send settled.
		// Never the `sent` status: it lives under a second and is not there to be
		// read. This is also what puts the redelivery in the window that matters —
		// the row the handler would look itself up by no longer exists.
		await waitForOutboxStatus(api, outboxMessageId, 404);

		expect(
			await serverUidsForSubject(run.imapUser, "Sent", subject),
		).toHaveLength(1);
		expect(await countAcceptedMessages(subject)).toBe(1);

		await enqueueAppendSentMessage(run.accountId, outboxMessageId);
		await waitForQueueDrained(MESSAGE_MGMT_QUEUE);

		// A second APPEND would ride the same queue this barrier rides, so once the
		// barrier is on the mail server, what the counts below read is final.
		await drainWithBarrier(
			async () => {
				await api.sendMessage({
					accountId: run.accountId,
					toAddresses: [RECIPIENT],
					subject: barrierSubject,
					textBody: "Barrier.",
				});
			},
			{ imapUser: run.imapUser, mailbox: "Sent", subject: barrierSubject },
		);

		expect(
			await serverUidsForSubject(run.imapUser, "Sent", subject),
		).toHaveLength(1);
		expect(await countAcceptedMessages(subject)).toBe(1);

		const deadLettered = await readVisibleBodies(MESSAGE_MGMT_DLQ);
		expect(
			deadLettered.filter((body) => body.includes(outboxMessageId)),
			"the redelivered filing event dead-lettered instead of being absorbed",
		).toEqual([]);
	});
});
