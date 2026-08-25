/**
 * A destructive action refuses when the folder role it needs carries too little
 * evidence, and still acts when it carries enough (#887, #876).
 *
 * Both halves are measured on the mail server. The refusal's whole claim is that
 * nothing happened — a read model that never wrote is no evidence of that, and
 * the fallback this replaces (file the mail into whatever reader would have
 * picked) was invisible in exactly the same way. So the first run reads the
 * message's UID out of Dovecot: IMAP has no in-place move, so an unchanged UID
 * is the server saying it was not touched at all. It reads that UID again behind
 * a second delete that is allowed to work, because a read taken the instant the
 * 409 lands cannot tell a refusal from a move still sitting on the queue.
 *
 * Each run owns a throwaway user. One appoints a Trash role and then deletes
 * that folder off the server, neither of which may reach another spec's account;
 * one lives on the mail server that flags no folder `\Trash` at all, which is
 * the only way to reach a Trash reader resolved from a name and nothing else.
 */
import { ApiClient, type ApiErrorBody, waitFor } from "../src/api.js";
import { drainWithBarrier } from "../src/barrier.js";
import { namedTrashImapLane } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	deleteServerMailbox,
	describeServerMailboxes,
	listServerMailboxes,
	listServerSubjects,
	serverUidsForSubject,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();

/** Dovecot gives every maildir a `\Trash`-flagged `Trash`, at the root. */
const FLAGGED_TRASH = "Trash";

/**
 * On the lane that flags nothing `\Trash`, the folder whose name is the only
 * evidence reader has (`namedTrashImapLane`).
 */
const NAMED_TRASH = "Deleted Messages";

test.describe("A delete whose appointed Trash folder is gone", () => {
	const appointedPath = `INBOX/Bak ${STAMP}`;
	const subject = `Stale trash appointment ${STAMP}`;
	const barrierSubject = `Stale trash barrier ${STAMP}`;
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Folder Role Refusal Stale");
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [
			{ subject },
			{ subject: barrierSubject },
		]);
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

		const messageId = await api.messageIdForSubject(run.inboxId, subject);
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
		expect(body.details?.role).toBe("Trash");
		expect(body.details?.reason).toBe("stale");
		expect(body.details?.accountId).toBe(run.accountId);

		// Repair the appointment, then put a second delete behind the refusal.
		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === FLAGGED_TRASH),
			{ timeoutMs: 90_000, what: "the flagged Trash folder to sync" },
		);
		const flaggedTrash = mailboxes.find(
			(box) => box.fullPath === FLAGGED_TRASH,
		);
		if (!flaggedTrash) throw new Error("unreachable: matched but not found");
		await api.appointFolderRole(run.accountId, "Trash", flaggedTrash.mailboxId);

		const barrierId = await api.messageIdForSubject(
			run.inboxId,
			barrierSubject,
		);
		await drainWithBarrier(
			async () => {
				const barrierDelete = await api.deleteMessages([barrierId]);
				expect(barrierDelete.successCount).toBe(1);
			},
			{
				imapUser: run.imapUser,
				mailbox: FLAGGED_TRASH,
				subject: barrierSubject,
				timeoutMs: 90_000,
			},
		);

		// The refusal's claim, read off Dovecot once the queue behind it has
		// drained: same mailbox, same UID, so no move happened — and the folder
		// reader would have fallen back to never received it.
		expect(await serverUidsForSubject(run.imapUser, "INBOX", subject)).toEqual(
			uidsBefore,
		);
		expect(await listServerSubjects(run.imapUser, FLAGGED_TRASH)).not.toContain(
			subject,
		);
	});
});

test.describe("A delete that would expunge inside a Trash matched by name", () => {
	const subject = `Named trash expunge ${STAMP}`;
	const barrierSubject = `Named trash barrier ${STAMP}`;
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(240_000);
		// The lane that flags no folder \Trash: reader files this account's
		// deletes in NAMED_TRASH because of its name, and nothing else says so.
		run = await provisionIsolatedRun(
			"E2E Folder Role Refusal Unconfirmed",
			[],
			{
				imap: namedTrashImapLane,
			},
		);
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [{ subject }], NAMED_TRASH);
		await appendMessages(run.imapUser, [{ subject: barrierSubject }]);
		await api.triggerSync(run.accountId);
	});

	test("refuses, and the message is still on the server afterwards", async () => {
		test.setTimeout(240_000);

		// The fixture is only worth something if the server really advertises no
		// SPECIAL-USE for the folder the delete would expunge inside.
		const onServer = await describeServerMailboxes(run.imapUser);
		expect(
			onServer.find((box) => box.path === NAMED_TRASH)?.specialUse,
		).toBeUndefined();
		expect(onServer.map((box) => box.specialUse)).not.toContain("\\Trash");

		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === NAMED_TRASH),
			{ timeoutMs: 90_000, what: `${NAMED_TRASH} to sync` },
		);
		const namedTrash = mailboxes.find((box) => box.fullPath === NAMED_TRASH);
		if (!namedTrash) throw new Error("unreachable: matched but not found");

		const messageId = await api.messageIdForSubject(
			namedTrash.mailboxId,
			subject,
		);
		const uidsBefore = await serverUidsForSubject(
			run.imapUser,
			NAMED_TRASH,
			subject,
		);
		expect(uidsBefore).toHaveLength(1);

		const response = await api.attemptDeleteMessages([messageId]);
		expect(response.status).toBe(409);
		const body = (await response.json()) as ApiErrorBody;
		expect(body.code).toBe("folder_role_unresolved");
		expect(body.details?.role).toBe("Trash");
		expect(body.details?.reason).toBe("unconfirmed");
		expect(body.details?.accountId).toBe(run.accountId);

		// A delete of a message outside that folder is allowed on the same
		// evidence — the name guess files mail somewhere retrievable, it just may
		// not destroy what is already there — so it is the barrier.
		const barrierId = await api.messageIdForSubject(
			run.inboxId,
			barrierSubject,
		);
		await drainWithBarrier(
			async () => {
				const barrierDelete = await api.deleteMessages([barrierId]);
				expect(barrierDelete.successCount).toBe(1);
			},
			{
				imapUser: run.imapUser,
				mailbox: NAMED_TRASH,
				subject: barrierSubject,
				timeoutMs: 90_000,
			},
		);

		// The refusal's claim, read off Dovecot once the queue behind it has
		// drained: same mailbox, same UID, so the message was never expunged.
		expect(
			await serverUidsForSubject(run.imapUser, NAMED_TRASH, subject),
		).toEqual(uidsBefore);
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

		const messageId = await api.messageIdForSubject(run.inboxId, subject);
		const deleted = await api.deleteMessages([messageId]);
		expect(deleted.successCount).toBe(1);

		// The expunge is UID-scoped, so it can only cover what the server already
		// holds in Trash.
		await waitForServerMailbox(
			run.imapUser,
			FLAGGED_TRASH,
			(subjects) => subjects.includes(subject),
			{
				timeoutMs: 90_000,
				what: `"${subject}" to reach the flagged Trash folder`,
			},
		);

		const emptied = await api.emptyTrash(run.accountId);
		expect(emptied.deletedCount).toBeGreaterThanOrEqual(1);

		await waitForServerMailbox(
			run.imapUser,
			FLAGGED_TRASH,
			(subjects) => subjects.length === 0,
			{ timeoutMs: 90_000, what: "the flagged Trash folder to end up empty" },
		);
	});
});
