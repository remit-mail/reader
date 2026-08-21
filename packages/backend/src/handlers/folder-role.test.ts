import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountSettingItem, MailboxItem } from "@remit/data-ports";
import { isPublicApiError } from "@remit/data-ports/errors";
import { composeFolderRoleAppointmentLabelName } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole, MailboxSyncStatus } from "@remit/domain-enums";
import { assertMailboxSettled } from "./folder-role.js";
import { applyMailboxPatch, type MailboxPatchClient } from "./mailbox.js";

const mailbox = (over: Partial<MailboxItem>): MailboxItem =>
	({
		mailboxId: "mb-1",
		fullPath: "INBOX/Prullenbak",
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

describe("applyMailboxPatch — the appointment label follows a rename", () => {
	const labelName = composeFolderRoleAppointmentLabelName(
		"acc-1",
		CanonicalMailboxRole.Trash,
	);

	const settingsFor = (
		rows: Record<string, string>,
	): { store: Record<string, string>; client: MailboxPatchClient } => {
		const store: Record<string, string> = { ...rows };
		const client = {
			mailbox: {
				get: async () => mailbox({}),
			},
			mailboxQueue: {
				renameMailbox: async (mailboxId: string, newPath: string) =>
					mailbox({ mailboxId, fullPath: newPath }),
			},
			accountSetting: {
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
				delete: async (_configId: string, name: string) => {
					delete store[name];
				},
			},
		} as unknown as MailboxPatchClient;
		return { store, client };
	};

	it("rewrites the recorded path for every role the folder holds", async () => {
		const { store, client } = settingsFor({
			[`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Trash}`]: "mb-1",
			[labelName]: "INBOX/Prullenbak",
		});

		await applyMailboxPatch(client, "cfg-1", "mb-1", "acc-1", {
			fullPath: "INBOX/Verwijderd",
		});

		assert.equal(store[labelName], "INBOX/Verwijderd");
	});

	it("leaves a folder no role appoints alone", async () => {
		const { store, client } = settingsFor({
			[`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Trash}`]: "mb-other",
			[labelName]: "INBOX/Prullenbak",
		});

		await applyMailboxPatch(client, "cfg-1", "mb-1", "acc-1", {
			fullPath: "INBOX/Verwijderd",
		});

		assert.equal(store[labelName], "INBOX/Prullenbak");
	});
});
