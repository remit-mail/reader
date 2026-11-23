import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const SUBJECT = `Your parcel is waiting for collection ${STAMP}`;
const SENDER_NAME = "Parcel Desk";
const SENDER_DOMAIN = "harbour-logistics.test";

test.describe("A Junk arrival no spam judge cleared", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let junkId: string;

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Junk Arrival");
		api = new ApiClient(run);

		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((mailbox) => mailbox.fullPath === "Junk"),
			{ timeoutMs: 60_000, what: "the Junk mailbox to sync" },
		);
		const junk = mailboxes.find((mailbox) => mailbox.fullPath === "Junk");
		if (!junk) throw new Error("unreachable: Junk was matched but not found");
		junkId = junk.mailboxId;
		await api.syncPastMailbox(run.accountId, "Junk");

		await appendMessages(
			run.imapUser,
			[
				{
					subject: SUBJECT,
					from: `${SENDER_NAME} <notices@${SENDER_DOMAIN}>`,
					body: "This one does not belong in Spam. Collect it at https://parcel-collect.test/track",
					headers: [
						[
							"DKIM-Signature",
							`v=1; a=rsa-sha256; d=${SENDER_DOMAIN}; s=s1; h=from:to; b=xxx`,
						],
					],
				},
			],
			"Junk",
		);
		await api.syncPastMailbox(run.accountId, "Junk");
	});

	test("stays in Junk", async () => {
		test.setTimeout(180_000);

		const threads = await waitFor(
			() => api.listThreads(junkId),
			(items) => items.some((thread) => thread.subject === SUBJECT),
			{ timeoutMs: 60_000, what: `"${SUBJECT}" to sync into Junk` },
		);
		const thread = threads.find((item) => item.subject === SUBJECT);
		if (!thread) throw new Error("unreachable: matched but not found");

		const messages = await waitFor(
			() => api.listThreadMessages(thread.threadId),
			(items) =>
				items.some(
					(item) =>
						item.messageId === thread.messageId &&
						item.authenticity !== undefined,
				),
			{
				timeoutMs: 60_000,
				what: `"${SUBJECT}" to be compared against its sender`,
			},
		);
		const authenticity = messages.find(
			(item) => item.messageId === thread.messageId,
		)?.authenticity;
		expect(authenticity?.fromDomain).toBe(SENDER_DOMAIN);
		expect(authenticity?.dkimMismatch).toBe(false);

		const inbox = await api.listThreads(run.inboxId);
		expect(inbox.some((item) => item.subject === SUBJECT)).toBe(false);
	});
});
