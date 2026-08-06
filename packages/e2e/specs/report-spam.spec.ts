/**
 * Report spam collapses the old separate `Block` (Address.flags.blocked, no
 * move) and `Mark spam` (move to Junk, no memory) actions into
 * `POST /messages/report-spam` / `POST /messages/not-spam`. Both are IMAP
 * mutations (docs/architecture/imap-mutations.md), so this measures the whole
 * path from outside: the message actually moves on the mail server, the
 * sender's block actually lands and survives the move settling, and undo
 * actually restores the server to where it started.
 *
 * Runs as its own throwaway user (see `src/provision.ts`) so the block it
 * writes on the seeded sender's Address never leaks into the shared account
 * other specs read.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	serverFlagsForSubject,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const SUBJECT = `Report spam ${STAMP}`;
const SENDER_EMAIL = `spammer-${STAMP}@remit.test`;
const READ_SUBJECT = `Report spam read-flag control ${STAMP}`;

const junkMailboxId = async (
	api: ApiClient,
	accountId: string,
): Promise<string> => {
	const mailboxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((mailbox) => mailbox.fullPath === "Junk"),
		{ timeoutMs: 60_000, what: "the Junk mailbox to sync" },
	);
	const junk = mailboxes.find((mailbox) => mailbox.fullPath === "Junk");
	if (!junk) throw new Error("unreachable: Junk was matched but not found");
	return junk.mailboxId;
};

test.describe("Report spam", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Report Spam");
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [
			{
				subject: SUBJECT,
				from: `Spammer <${SENDER_EMAIL}>`,
				body: `Body of ${SUBJECT}.`,
			},
			// A second, unrelated message for the outbound-flag-push regression
			// check below — kept separate from the report-spam flow so that test
			// asserts nothing but the read flag actually reaching the server.
			{ subject: READ_SUBJECT, body: `Body of ${READ_SUBJECT}.` },
		]);
		await api.triggerSync(run.accountId);
	});

	test("report puts the message in Junk on the server, the sender block survives, and undo restores it", async () => {
		test.setTimeout(180_000);

		const thread = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((t) => t.subject === SUBJECT),
			{ timeoutMs: 60_000, what: `"${SUBJECT}" to sync into the inbox` },
		).then((items) => {
			const match = items.find((t) => t.subject === SUBJECT);
			if (!match) throw new Error("unreachable: matched but not found");
			return match;
		});

		// The backend resolves the account's Junk mailbox by special-use; it has
		// to have synced in before report-spam can move anything into it.
		await junkMailboxId(api, run.accountId);

		const reportResult = await api.reportSpam([thread.messageId]);
		expect(reportResult.successCount).toBe(1);

		// The move has to actually land on the mail server, not just in the
		// read model — the read model updates optimistically before the IMAP
		// write ever happens.
		await waitForServerMailbox(
			run.imapUser,
			"Junk",
			(subjects) => subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to reach Junk` },
		);
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to leave the inbox` },
		);

		// The move landing is not the same thing as the $Junk keyword landing —
		// they are two independent mutations (MessageMoveService + FlagPushService),
		// and the one mechanism this rework changed (the imap-worker's outbound
		// flag-push guard) is proven only by checking the keyword itself.
		const junkFlags = await waitFor(
			() => serverFlagsForSubject(run.imapUser, "Junk", SUBJECT),
			(flags) => flags.includes("$Junk"),
			{ timeoutMs: 60_000, what: `"${SUBJECT}" to carry $Junk on the server` },
		);
		expect(junkFlags).toContain("$Junk");

		// The sender block was written before the move and must not have been
		// rolled back once the move settled.
		const blockedAddresses = await waitFor(
			() => api.searchAddresses(SENDER_EMAIL),
			(items) =>
				items.some(
					(a) =>
						a.normalizedEmail === SENDER_EMAIL &&
						a.flags?.blocked?.value === true,
				),
			{ timeoutMs: 30_000, what: `${SENDER_EMAIL} to be blocked` },
		);
		expect(
			blockedAddresses.find((a) => a.normalizedEmail === SENDER_EMAIL)?.flags
				?.blocked?.value,
		).toBe(true);

		// The provenance the client renders "Reported as spam · Undo" from.
		const reported = await waitFor(
			() => api.describeMessage(thread.messageId),
			(message) => message.spamReport !== undefined,
			{ timeoutMs: 30_000, what: "spamReport provenance to appear" },
		);
		expect(reported.spamReport?.reportedAt).toBeGreaterThan(0);

		const undoResult = await api.notSpam([thread.messageId]);
		expect(undoResult.successCount).toBe(1);

		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to return to the inbox` },
		);
		await waitForServerMailbox(
			run.imapUser,
			"Junk",
			(subjects) => !subjects.includes(SUBJECT),
			{ what: `"${SUBJECT}" to leave Junk` },
		);

		const unblockedAddresses = await waitFor(
			() => api.searchAddresses(SENDER_EMAIL),
			(items) =>
				items.some(
					(a) =>
						a.normalizedEmail === SENDER_EMAIL &&
						a.flags?.blocked?.value !== true,
				),
			{ timeoutMs: 30_000, what: `${SENDER_EMAIL} to be unblocked` },
		);
		expect(
			unblockedAddresses.find((a) => a.normalizedEmail === SENDER_EMAIL)?.flags
				?.blocked,
		).toBeUndefined();

		const undone = await waitFor(
			() => api.describeMessage(thread.messageId),
			(message) => message.spamReport === undefined,
			{ timeoutMs: 30_000, what: "spamReport provenance to clear" },
		);
		expect(undone.spamReport).toBeUndefined();
		expect(undone.mailboxId).toBe(run.inboxId);
	});

	// Not about report-spam itself — this is the real guard. The imap-worker's
	// outbound flag-push handler is shared by every read/star flip in the
	// product (flag-queue.ts -> FlagPushService.flip -> FLAG_PUSH), and this
	// rework changed the one guard that gates it. Nothing else in the suite
	// asserts that outbound flag push reaches the server at all, which is
	// exactly why a change that silently disabled it for every ordinary
	// message went green.
	test("marking a message read pushes \\Seen to the server", async () => {
		test.setTimeout(120_000);

		const thread = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((t) => t.subject === READ_SUBJECT),
			{ timeoutMs: 60_000, what: `"${READ_SUBJECT}" to sync into the inbox` },
		).then((items) => {
			const match = items.find((t) => t.subject === READ_SUBJECT);
			if (!match) throw new Error("unreachable: matched but not found");
			return match;
		});

		await api.updateMessageFlags(thread.messageId, { isRead: true });

		const flags = await waitFor(
			() => serverFlagsForSubject(run.imapUser, "INBOX", READ_SUBJECT),
			(f) => f.includes("\\Seen"),
			{
				timeoutMs: 60_000,
				what: `"${READ_SUBJECT}" to carry \\Seen on the server`,
			},
		);
		expect(flags).toContain("\\Seen");
	});
});
