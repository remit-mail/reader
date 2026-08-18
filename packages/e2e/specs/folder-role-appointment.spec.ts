/**
 * The folder a user appoints to a role is the folder the operation uses (#837).
 *
 * The shared fixture's Junk is a root-level `Junk` carrying SPECIAL-USE, which
 * every heuristic in the series happened to agree on — so both the `INBOX/Sent`
 * bug (#824) and the `INBOX/Spam` one reached the instance with the e2e suite
 * green. This runs Report spam against a nested folder that carries no
 * SPECIAL-USE and whose name matches no convention: nothing but the
 * appointment can send the message there.
 *
 * Its own throwaway user, like report-spam.spec.ts: it writes a sender block
 * and re-appoints a role, neither of which may leak into the shared account.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, waitForServerMailbox } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const APPOINTED_PATH = `INBOX/Rubbish ${STAMP}`;
const SUBJECT = `Appointed junk folder ${STAMP}`;
const SENDER_EMAIL = `appointed-spammer-${STAMP}@remit.test`;

test.describe("An appointed folder role", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Folder Role Appointment");
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [
			{
				subject: SUBJECT,
				from: `Spammer <${SENDER_EMAIL}>`,
				body: `Body of ${SUBJECT}.`,
			},
		]);
		await api.triggerSync(run.accountId);
	});

	test("sends Report spam to the appointed folder, not the one the server flagged", async () => {
		test.setTimeout(180_000);

		const appointed = await api.createMailbox(run.accountId, APPOINTED_PATH);
		await api.appointFolderRole(run.accountId, "Junk", appointed.mailboxId);

		// The account also has the Dovecot `Junk` that carries \Junk, which is
		// what report-spam would pick without an appointment.
		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === "Junk"),
			{ timeoutMs: 60_000, what: "the flagged Junk mailbox to sync" },
		);
		expect(mailboxes.map((box) => box.fullPath)).toContain(APPOINTED_PATH);

		const thread = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((t) => t.subject === SUBJECT),
			{ timeoutMs: 60_000, what: `"${SUBJECT}" to sync into the inbox` },
		).then((items) => {
			const match = items.find((t) => t.subject === SUBJECT);
			if (!match) throw new Error("unreachable: matched but not found");
			return match;
		});

		const reportResult = await api.reportSpam([thread.messageId]);
		expect(reportResult.successCount).toBe(1);

		// Measured on the mail server, not the read model: the read model
		// updates optimistically before the IMAP write happens.
		await waitForServerMailbox(
			run.imapUser,
			APPOINTED_PATH,
			(subjects) => subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to reach the appointed folder` },
		);
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to leave the inbox` },
		);

		const flaggedJunk = await waitForServerMailbox(
			run.imapUser,
			"Junk",
			() => true,
			{ what: `"${SUBJECT}" never to reach the flagged Junk folder` },
		);
		expect(flaggedJunk).not.toContain(SUBJECT);
	});
});
