import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountSettingItem, MailboxItem } from "@remit/data-ports";
import { isPublicApiError } from "@remit/data-ports/errors";
import { composeFolderRoleAppointmentLabelName } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole, MailboxSyncStatus } from "@remit/domain-enums";
import { assertMailboxSettled } from "./folder-role.js";
import { refreshFolderAppointmentLabels } from "./folder-role-labels.js";

const mailbox = (over: Partial<MailboxItem>): MailboxItem =>
	({
		mailboxId: "mb-1",
		fullPath: "INBOX/Prullenbak",
		hierarchyDelimiter: "/",
		...over,
	}) as unknown as MailboxItem;

const caught = (run: () => void): unknown => {
	let thrown: unknown;
	assert.throws(run, (error: unknown) => {
		thrown = error;
		return true;
	});
	return thrown;
};

const publicErrorOf = (error: unknown) => {
	if (typeof error !== "object" || error === null) return undefined;
	const { publicApiError } = error as { publicApiError?: unknown };
	return isPublicApiError(publicApiError) ? publicApiError : undefined;
};

describe("assertMailboxSettled", () => {
	it("refuses a folder the mail server has not created yet", () => {
		const error = caught(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.pending })),
		);
		assert.equal(publicErrorOf(error)?.code, "mailbox_not_settled");
	});

	it("refuses a folder on its way out", () => {
		const error = caught(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.deleting })),
		);
		assert.equal(publicErrorOf(error)?.code, "mailbox_not_settled");
	});

	it("carries the mailbox and its state, so the client words a wait", () => {
		const error = caught(() =>
			assertMailboxSettled(
				mailbox({ mailboxId: "mb-9", syncStatus: MailboxSyncStatus.pending }),
			),
		);
		assert.deepEqual(publicErrorOf(error)?.details, {
			mailboxId: "mb-9",
			syncStatus: "pending",
		});
	});

	it("allows a settled folder, and one whose delete failed", () => {
		assert.doesNotThrow(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.synced })),
		);
		assert.doesNotThrow(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.failed })),
		);
		assert.doesNotThrow(() => assertMailboxSettled(mailbox({})));
	});
});

describe("refreshFolderAppointmentLabels — the label follows a settled rename", () => {
	const labelName = composeFolderRoleAppointmentLabelName(
		"acc-1",
		CanonicalMailboxRole.Trash,
	);
	const sentLabelName = composeFolderRoleAppointmentLabelName(
		"acc-1",
		CanonicalMailboxRole.Sent,
	);
	const appointmentName = (role: string) =>
		`FolderRoleAppointment#acc-1#${role}`;

	const settingsFor = (
		rows: Record<string, string>,
	): {
		store: Record<string, string>;
		accountSetting: Parameters<typeof refreshFolderAppointmentLabels>[0];
	} => {
		const store: Record<string, string> = { ...rows };
		const accountSetting = {
			get: async (_configId: string, name: string) =>
				store[name] === undefined
					? undefined
					: ({
							name,
							value: { kind: "String", value: store[name] },
						} as AccountSettingItem),
			upsert: async (item: AccountSettingItem) => {
				if (item.value.kind === "String") store[item.name] = item.value.value;
				return item;
			},
		} as unknown as Parameters<typeof refreshFolderAppointmentLabels>[0];
		return { store, accountSetting };
	};

	const settle = (
		accountSetting: Parameters<typeof refreshFolderAppointmentLabels>[0],
		renamed: { mailboxId: string; oldPath: string; newPath: string },
	) =>
		refreshFolderAppointmentLabels(
			accountSetting,
			"cfg-1",
			"acc-1",
			renamed,
			"/",
		);

	it("rewrites the recorded path for the folder that was renamed", async () => {
		const { store, accountSetting } = settingsFor({
			[appointmentName(CanonicalMailboxRole.Trash)]: "mb-1",
			[labelName]: "INBOX/Prullenbak",
		});

		await settle(accountSetting, {
			mailboxId: "mb-1",
			oldPath: "INBOX/Prullenbak",
			newPath: "INBOX/Verwijderd",
		});

		assert.equal(store[labelName], "INBOX/Verwijderd");
	});

	// IMAP RENAME moves the subtree in one command, so every label under the
	// branch moves with it.
	it("carries every appointed folder under the renamed branch with it", async () => {
		const { store, accountSetting } = settingsFor({
			[appointmentName(CanonicalMailboxRole.Trash)]: "mb-trash",
			[labelName]: "INBOX/Prullenbak",
			[appointmentName(CanonicalMailboxRole.Sent)]: "mb-sent",
			[sentLabelName]: "INBOX/Verzonden",
		});

		await settle(accountSetting, {
			mailboxId: "mb-1",
			oldPath: "INBOX",
			newPath: "Mail",
		});

		assert.equal(store[labelName], "Mail/Prullenbak");
		assert.equal(store[sentLabelName], "Mail/Verzonden");
	});

	it("leaves a folder outside the renamed branch alone", async () => {
		const { store, accountSetting } = settingsFor({
			[appointmentName(CanonicalMailboxRole.Trash)]: "mb-trash",
			[labelName]: "Archief/Prullenbak",
		});

		await settle(accountSetting, {
			mailboxId: "mb-1",
			oldPath: "INBOX",
			newPath: "Mail",
		});

		assert.equal(store[labelName], "Archief/Prullenbak");
	});

	it("never rebases a sibling that merely shares the prefix", async () => {
		const { store, accountSetting } = settingsFor({
			[appointmentName(CanonicalMailboxRole.Trash)]: "mb-trash",
			[labelName]: "INBOXES/Prullenbak",
		});

		await settle(accountSetting, {
			mailboxId: "mb-1",
			oldPath: "INBOX",
			newPath: "Mail",
		});

		assert.equal(store[labelName], "INBOXES/Prullenbak");
	});
});
