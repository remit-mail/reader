import type { AccountSettingItem } from "@remit/data-ports";
import { SETTING_NAME_SEPARATOR } from "@remit/data-ports/account-settings";
import {
	type CanonicalMailboxRoleValue,
	parseFolderRoleAppointmentLabelName,
	parseFolderRoleAppointmentName,
} from "@remit/data-ports/folder-role";
import { AccountSettingName } from "@remit/domain-enums";

/** One account's settings rows, already split out of the config-wide batch. */
export interface AccountSettingsView {
	displayName: string;
	muted: MutedValue | null;
	composeLanguages: string[];
	signaturePlainText: string;
	signatureHtml: string;
	/** role → the mailbox appointed to it, and the path it had when appointed. */
	roles: Map<CanonicalMailboxRoleValue, RoleAppointmentView>;
}

export interface RoleAppointmentView {
	mailboxId: string;
	lastKnownPath: string | undefined;
}

export interface MailboxSettingsView {
	displayName: string;
	muted: MutedValue | null;
}

export type MutedValue = Extract<
	AccountSettingItem["value"],
	{ kind: "MutedFlag" }
>["value"];

export interface SettingsView {
	defaultComposerFormat: string | undefined;
	/**
	 * The folder paths the user pinned. Stored once for the whole configuration,
	 * un-suffixed, which is the only per-target setting the registry does not
	 * spell per account — so it is read here rather than under an account, and
	 * the export resolves each path against the account that holds it.
	 */
	pinnedFolders: string[];
	byAccount: Map<string, AccountSettingsView>;
	byMailbox: Map<string, MailboxSettingsView>;
}

/** An account nobody has set anything on. */
export const emptyAccountSettings = (): AccountSettingsView => ({
	displayName: "",
	muted: null,
	composeLanguages: [],
	signaturePlainText: "",
	signatureHtml: "",
	roles: new Map(),
});

const emptyMailboxView = (): MailboxSettingsView => ({
	displayName: "",
	muted: null,
});

const splitName = (name: string): { base: string; target: string } => {
	const index = name.indexOf(SETTING_NAME_SEPARATOR);
	if (index === -1) return { base: name, target: "" };
	return {
		base: name.slice(0, index),
		target: name.slice(index + SETTING_NAME_SEPARATOR.length),
	};
};

const stringOf = (item: AccountSettingItem): string | undefined =>
	item.value.kind === "String" ? item.value.value : undefined;

const stringListOf = (item: AccountSettingItem): string[] | undefined =>
	item.value.kind === "StringList" ? item.value.value : undefined;

const mutedOf = (item: AccountSettingItem): MutedValue | undefined =>
	item.value.kind === "MutedFlag" ? item.value.value : undefined;

/**
 * Split one configuration's whole settings batch into the shape the export
 * reads. Every per-target setting is stored as a composite `<base>#<target>`
 * row against the configuration, so a single `listByAccountConfig` holds every
 * account's and every folder's overrides at once.
 *
 * A row whose base this build does not recognise is passed over rather than
 * refused: an export written by a reader that has since learned a new setting
 * still has to produce the settings it does know.
 */
export const readSettings = (settings: AccountSettingItem[]): SettingsView => {
	const view: SettingsView = {
		defaultComposerFormat: undefined,
		pinnedFolders: [],
		byAccount: new Map(),
		byMailbox: new Map(),
	};

	const account = (id: string): AccountSettingsView => {
		const current = view.byAccount.get(id) ?? emptyAccountSettings();
		view.byAccount.set(id, current);
		return current;
	};
	const mailbox = (id: string): MailboxSettingsView => {
		const current = view.byMailbox.get(id) ?? emptyMailboxView();
		view.byMailbox.set(id, current);
		return current;
	};

	for (const setting of settings) {
		const appointment = parseFolderRoleAppointmentName(setting.name);
		if (appointment) {
			const mailboxId = stringOf(setting);
			if (mailboxId === undefined) continue;
			account(appointment.accountId).roles.set(appointment.role, {
				mailboxId,
				lastKnownPath: undefined,
			});
			continue;
		}

		const { base, target } = splitName(setting.name);

		if (base === AccountSettingName.DefaultComposerFormat) {
			view.defaultComposerFormat = stringOf(setting);
			continue;
		}

		if (base === AccountSettingName.PinnedFolders) {
			view.pinnedFolders = stringListOf(setting) ?? [];
			continue;
		}

		if (target === "") continue;

		switch (base) {
			case AccountSettingName.AccountDisplayName: {
				const value = stringOf(setting);
				if (value !== undefined) account(target).displayName = value;
				break;
			}
			case AccountSettingName.AccountMuted: {
				const value = mutedOf(setting);
				if (value !== undefined) account(target).muted = value;
				break;
			}
			case AccountSettingName.AccountComposeLanguages: {
				const value = stringListOf(setting);
				if (value !== undefined) account(target).composeLanguages = value;
				break;
			}
			case AccountSettingName.AccountSignaturePlainText: {
				const value = stringOf(setting);
				if (value !== undefined) account(target).signaturePlainText = value;
				break;
			}
			case AccountSettingName.AccountSignatureHtml: {
				const value = stringOf(setting);
				if (value !== undefined) account(target).signatureHtml = value;
				break;
			}
			case AccountSettingName.MailboxDisplayName: {
				const value = stringOf(setting);
				if (value !== undefined) mailbox(target).displayName = value;
				break;
			}
			case AccountSettingName.MailboxMuted: {
				const value = mutedOf(setting);
				if (value !== undefined) mailbox(target).muted = value;
				break;
			}
			default:
				break;
		}
	}

	// Second pass: the recorded path rides a sibling row, so it can only be
	// attached once every appointment it belongs to has been read.
	for (const setting of settings) {
		const label = parseFolderRoleAppointmentLabelName(setting.name);
		if (!label) continue;
		const path = stringOf(setting);
		if (path === undefined) continue;
		const appointment = view.byAccount
			.get(label.accountId)
			?.roles.get(label.role);
		if (!appointment) continue;
		appointment.lastKnownPath = path;
	}

	return view;
};
