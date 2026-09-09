import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountSettingItem, MailboxItem } from "@remit/data-ports";
import { isPublicApiError } from "@remit/data-ports/errors";
import { composeFolderRoleAppointmentLabelName } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole, MailboxSyncStatus } from "@remit/domain-enums";
import { refreshFolderAppointmentLabels } from "./folder-role-labels.js";
import { assertMailboxSettled } from "./mailbox.js";

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

	it("refuses a folder whose last change failed", () => {
		// `failed` means the folder exists at `fullPath` and the last rename or
		// delete did not land, so it is exactly as unready to be bound to as a
		// folder mid-mutation — and the user has a retry or a dismissal to make
		// before anything should point at it.
		const error = caught(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.failed })),
		);
		assert.equal(publicErrorOf(error)?.code, "mailbox_not_settled");
	});

	it("answers 422, not 409", () => {
		// 409 already means "this folder is being changed right now, refresh".
		// This means "the folder you are pointing at has not settled yet", which
		// is different copy and a different remedy (D4).
		const error = caught(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.pending })),
		);
		assert.equal((error as { statusCode?: number }).statusCode, 422);
	});

	it("words each state differently, because each has its own remedy", () => {
		const messageFor = (syncStatus: MailboxItem["syncStatus"]) =>
			(caught(() => assertMailboxSettled(mailbox({ syncStatus }))) as Error)
				.message;

		assert.match(messageFor(MailboxSyncStatus.pending), /hasn.t confirmed it/);
		assert.match(messageFor(MailboxSyncStatus.deleting), /being deleted/);
		assert.match(messageFor(MailboxSyncStatus.failed), /Retry or dismiss/);
	});

	it("allows a settled folder", () => {
		assert.doesNotThrow(() =>
			assertMailboxSettled(mailbox({ syncStatus: MailboxSyncStatus.synced })),
		);
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
