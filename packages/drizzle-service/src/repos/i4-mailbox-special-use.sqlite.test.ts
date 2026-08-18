import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { composeFolderRoleAppointmentName } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import {
	accountSettingTable,
	accountTable,
	mailboxSpecialUseTable,
	mailboxTable,
} from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { AccountSettingRepo } from "./i4-account-setting.js";
import { MailboxRepo } from "./i4-mailbox.js";
import { MailboxSpecialUseRepo } from "./i4-mailbox-special-use.js";

const makeMailboxInput = (accountId: string, fullPath: string) => ({
	accountId,
	namespaceType: "personal" as const,
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	fullPath,
	uidValidity: 1,
	uidNext: 1,
	highestModseq: "0",
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	totalSize: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: Date.now(),
});

describe("MailboxSpecialUseRepo role lookups (sqlite)", () => {
	let close: () => Promise<void>;
	let repo: MailboxSpecialUseRepo;
	let mailboxes: MailboxRepo;
	let accountSettings: AccountSettingRepo;
	let db: Awaited<ReturnType<typeof createSqliteTestDb>>["db"];

	before(async () => {
		const testDb = await createSqliteTestDb({
			account: accountTable,
			accountSetting: accountSettingTable,
			mailbox: mailboxTable,
			mailboxSpecialUse: mailboxSpecialUseTable,
		});
		close = testDb.close;
		db = testDb.db;
		repo = new MailboxSpecialUseRepo(testDb.db as never);
		mailboxes = new MailboxRepo(testDb.db as never);
		accountSettings = new AccountSettingRepo(testDb.db as never);
	});

	after(async () => {
		await close();
	});

	const makeAccount = async (): Promise<{
		accountId: string;
		accountConfigId: string;
	}> => {
		const accountId = randomUUID();
		const accountConfigId = randomUUID();
		const now = Date.now();
		await db.insert(accountTable).values({
			accountId,
			accountConfigId,
			username: `${accountId}@remit.test`,
			email: `${accountId}@remit.test`,
			imapHost: "imap.remit.test",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: "authenticated",
			createdAt: now,
			updatedAt: now,
		} as never);
		return { accountId, accountConfigId };
	};

	const appoint = (
		accountConfigId: string,
		accountId: string,
		role: (typeof CanonicalMailboxRole)[keyof typeof CanonicalMailboxRole],
		mailboxId: string,
	): Promise<unknown> =>
		accountSettings.upsert({
			accountConfigId,
			name: composeFolderRoleAppointmentName(accountId, role),
			value: { kind: "String", value: mailboxId },
		});

	test("the appointment beats the folder the server flagged", async () => {
		const { accountId, accountConfigId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const flagged = await mailboxes.create(makeMailboxInput(accountId, "Junk"));
		await repo.create(flagged.mailboxId, "Junk");
		const chosen = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Rubbish"),
		);
		await appoint(
			accountConfigId,
			accountId,
			CanonicalMailboxRole.Junk,
			chosen.mailboxId,
		);

		const found = await repo.findJunkMailbox(accountId);
		assert.equal(found?.mailboxId, chosen.mailboxId);
	});

	test("an appointment on [Gmail]/Trash wins over a top-level Bin the name rule would pick", async () => {
		// #837: the name proposal ranks a shallow folder above a nested one, so
		// `Bin` beats `[Gmail]/Trash` and deletes land in the wrong folder. What
		// the user appointed settles it.
		const { accountId, accountConfigId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const bin = await mailboxes.create(makeMailboxInput(accountId, "Bin"));
		const gmailTrash = await mailboxes.create(
			makeMailboxInput(accountId, "[Gmail]/Trash"),
		);

		assert.equal(
			(await repo.findTrashMailbox(accountId))?.mailboxId,
			bin.mailboxId,
		);

		await appoint(
			accountConfigId,
			accountId,
			CanonicalMailboxRole.Trash,
			gmailTrash.mailboxId,
		);
		assert.equal(
			(await repo.findTrashMailbox(accountId))?.mailboxId,
			gmailTrash.mailboxId,
		);
	});

	test("an appointment on a mailbox that is gone falls back rather than resolving to nothing", async () => {
		const { accountId, accountConfigId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const archive = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Archive"),
		);
		await appoint(
			accountConfigId,
			accountId,
			CanonicalMailboxRole.Archive,
			randomUUID(),
		);

		const found = await repo.findArchiveMailbox(accountId);
		assert.equal(found?.mailboxId, archive.mailboxId);
	});

	test("never offers a user folder named Deleted as the Trash to expunge", async () => {
		// Empty Trash EXPUNGES what this returns. An ordinary folder called
		// `Deleted` matches the name proposal, and emptying it would destroy mail
		// the user never put in a trash folder (audit #841).
		const { accountId, accountConfigId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const keepsakes = await mailboxes.create(
			makeMailboxInput(accountId, "Deleted"),
		);
		const trash = await mailboxes.create(
			makeMailboxInput(accountId, "[Gmail]/Trash"),
		);

		assert.equal(await repo.findConfirmedTrashMailbox(accountId), null);

		await appoint(
			accountConfigId,
			accountId,
			CanonicalMailboxRole.Trash,
			trash.mailboxId,
		);
		const confirmed = await repo.findConfirmedTrashMailbox(accountId);
		assert.equal(confirmed?.mailboxId, trash.mailboxId);
		assert.notEqual(confirmed?.mailboxId, keepsakes.mailboxId);
	});

	test("resolves an INBOX-nested Junk folder that advertises \\Junk", async () => {
		const { accountId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const spam = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Spam"),
		);
		await repo.create(spam.mailboxId, "Junk");

		const found = await repo.findJunkMailbox(accountId);
		assert.equal(found?.mailboxId, spam.mailboxId);
	});

	test("resolves an INBOX-nested Junk folder that advertises no special use", async () => {
		// The name fallback used to compare the whole path against a list of
		// bare names, so `INBOX/Spam` resolved to nothing on a server that
		// advertises no \Junk.
		const { accountId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const spam = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Spam"),
		);

		const found = await repo.findJunkMailbox(accountId);
		assert.equal(found?.mailboxId, spam.mailboxId);
	});

	test("answers null when the account has no Junk folder at all", async () => {
		const { accountId } = await makeAccount();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		await mailboxes.create(makeMailboxInput(accountId, "INBOX/Work"));

		assert.equal(await repo.findJunkMailbox(accountId), null);
	});
});
