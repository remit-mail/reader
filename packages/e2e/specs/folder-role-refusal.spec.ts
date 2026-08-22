/**
 * A destructive action refuses when the folder role it needs is unresolved, and
 * still acts when it is resolved (#887).
 *
 * Both halves are measured on the mail server. The refusal's whole claim is that
 * nothing happened — a read model that never wrote is no evidence of that, and
 * the fallback this replaces (file the mail into whatever reader would have
 * picked) was invisible in exactly the same way. So the first run reads the
 * message's UID out of Dovecot: IMAP has no in-place move, so an unchanged UID
 * is the server saying it was not touched at all.
 *
 * Each run owns a throwaway user. One appoints a Trash role and then deletes
 * that folder off the server, neither of which may reach another spec's account.
 */
import { ApiClient, type ApiErrorBody, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	deleteServerMailbox,
	listServerMailboxes,
	listServerSubjects,
	serverUidsForSubject,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();

/** Dovecot gives every maildir a `\Trash`-flagged `Trash`, at the root. */
const FLAGGED_TRASH = "Trash";

const messageIdInInbox = async (
	api: ApiClient,
	inboxId: string,
	subject: string,
): Promise<string> => {
	const threads = await waitFor(
		() => api.listThreads(inboxId),
		(items) => items.some((thread) => thread.subject === subject),
		{ timeoutMs: 90_000, what: `"${subject}" to sync into the inbox` },
	);
	const match = threads.find((thread) => thread.subject === subject);
	if (!match) throw new Error("unreachable: matched but not found");
	return match.messageId;
};

test.describe("A delete whose appointed Trash folder is gone", () => {
	const appointedPath = `INBOX/Bak ${STAMP}`;
	const subject = `Stale trash appointment ${STAMP}`;
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Folder Role Refusal Stale");
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [{ subject }]);
		await api.triggerSync(run.accountId);
	});

	test("refuses, and leaves the message untouched on the server", async () => {
		test.setTimeout(240_000);

		const appointed = await api.createSettledMailbox(
			run.accountId,
			appointedPath,
		);
		await api.appointFolderRole(run.accountId, "Trash", appointed.mailboxId);

		// Behind the app's back, the way a second mail client would.
		await deleteServerMailbox(run.imapUser, appointedPath);
		expect(await listServerMailboxes(run.imapUser)).not.toContain(
			appointedPath,
		);

		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => !list.some((box) => box.fullPath === appointedPath),
			{
				timeoutMs: 90_000,
				what: "the appointed folder to leave the read model",
			},
		);

		const messageId = await messageIdInInbox(api, run.inboxId, subject);
		const uidsBefore = await serverUidsForSubject(
			run.imapUser,
			"INBOX",
			subject,
		);
		expect(uidsBefore).toHaveLength(1);

		const response = await api.attemptDeleteMessages([messageId]);
		expect(response.status).toBe(409);
		const body = (await response.json()) as ApiErrorBody;
		expect(body.code).toBe("folder_role_unresolved");
		expect(body.details?.reason).toBe("stale");
		expect(body.details?.accountId).toBe(run.accountId);

		// The refusal's claim, read off Dovecot: same mailbox, same UID, so no
		// move happened — and the folder reader would have fallen back to never
		// received it.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => subjects.includes(subject),
			{ what: `"${subject}" to still be in the inbox` },
		);
		expect(await serverUidsForSubject(run.imapUser, "INBOX", subject)).toEqual(
			uidsBefore,
		);
		expect(await listServerSubjects(run.imapUser, FLAGGED_TRASH)).not.toContain(
			subject,
		);
	});
});

test.describe("Empty Trash on the folder the server flagged", () => {
	const subject = `Flagged trash empty ${STAMP}`;
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Folder Role Refusal Empty");
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [{ subject }]);
		await api.triggerSync(run.accountId);
	});

	test("empties it, rather than refusing a folder nobody appointed", async () => {
		test.setTimeout(240_000);

		const messageId = await messageIdInInbox(api, run.inboxId, subject);
		const deleted = await api.deleteMessages([messageId]);
		expect(deleted.successCount).toBe(1);

		// The expunge is UID-scoped, so it can only cover what the server already
		// holds in Trash.
		await waitForServerMailbox(
			run.imapUser,
			FLAGGED_TRASH,
			(subjects) => subjects.includes(subject),
			{ what: `"${subject}" to reach the flagged Trash folder` },
		);

		const emptied = await api.emptyTrash(run.accountId);
		expect(emptied.deletedCount).toBeGreaterThanOrEqual(1);

		await waitForServerMailbox(
			run.imapUser,
			FLAGGED_TRASH,
			(subjects) => subjects.length === 0,
			{ what: "the flagged Trash folder to end up empty" },
		);
	});
});
