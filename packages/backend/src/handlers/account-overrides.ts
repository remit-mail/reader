import type {
	AccountSettingItem,
	IAccountSettingRepository,
} from "@remit/data-ports";
import {
	baseSettingName,
	composeSettingName,
	SETTING_NAME_SEPARATOR,
} from "@remit/remit-electrodb-service";
import type { MutedFlag } from "@remit/api-openapi-types";

/**
 * RFC 032 Tier 1: the per-account display name and mute flag, and the
 * per-mailbox display-name override and mute flag, live in AccountSetting
 * rows — not on the Account/Mailbox entities. They are stored as composite-named
 * rows keyed by the target id (`AccountDisplayName#<accountId>`,
 * `MailboxMuted#<mailboxId>`, …), so one `listByAccountConfig` query yields every
 * target's overrides; readers group them by the `#<targetId>` suffix. This mirrors
 * the signature helper (`account-signature.ts`). The per-folder role override
 * this module used to carry is superseded by the per-account role map — see
 * `folder-role-appointments.ts` (RFC 032 exclusive-folder-appointment, #976).
 */

const ACCOUNT_OVERRIDE_NAMES = {
	displayName: "AccountDisplayName",
	muted: "AccountMuted",
} as const;

const MAILBOX_OVERRIDE_NAMES = {
	displayName: "MailboxDisplayName",
	muted: "MailboxMuted",
} as const;

export interface AccountOverrides {
	displayName?: string;
	muted?: MutedFlag;
}

export interface MailboxOverrides {
	displayNameOverride?: string;
	muted?: MutedFlag;
}

const stringValueOf = (item: AccountSettingItem): string | undefined => {
	const { value } = item;
	if (value.kind === "String") return value.value;
	return undefined;
};

const mutedValueOf = (item: AccountSettingItem): MutedFlag | undefined => {
	const { value } = item;
	if (value.kind === "MutedFlag") return value.value;
	return undefined;
};

const targetIdOf = (name: string): string | undefined => {
	const idx = name.indexOf(SETTING_NAME_SEPARATOR);
	if (idx === -1) return undefined;
	return name.slice(idx + SETTING_NAME_SEPARATOR.length) || undefined;
};

// ============================================
// Account overrides (displayName + muted)
// ============================================

export const groupAccountOverrides = (
	settings: AccountSettingItem[],
): Map<string, AccountOverrides> => {
	const byAccount = new Map<string, AccountOverrides>();
	for (const setting of settings) {
		const accountId = targetIdOf(setting.name);
		if (!accountId) continue;
		const base = baseSettingName(setting.name);
		if (base === ACCOUNT_OVERRIDE_NAMES.displayName) {
			const displayName = stringValueOf(setting);
			if (displayName === undefined) continue;
			const current = byAccount.get(accountId) ?? {};
			current.displayName = displayName;
			byAccount.set(accountId, current);
			continue;
		}
		if (base === ACCOUNT_OVERRIDE_NAMES.muted) {
			const muted = mutedValueOf(setting);
			if (muted === undefined) continue;
			const current = byAccount.get(accountId) ?? {};
			current.muted = muted;
			byAccount.set(accountId, current);
		}
	}
	return byAccount;
};

/**
 * Load every account's display-name/mute overrides for an account configuration
 * in one query, grouped by accountId. Callers reading multiple accounts
 * (GET /config) use this once.
 */
export const loadAccountOverridesForConfig = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
): Promise<Map<string, AccountOverrides>> => {
	const settings = await accountSetting.listByAccountConfig(accountConfigId);
	return groupAccountOverrides(settings);
};

/**
 * Resolve one account's display-name/mute overrides by reading just its two
 * composite rows. Used by the account create/update handlers.
 */
export const loadAccountOverrides = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	accountId: string,
): Promise<AccountOverrides> => {
	const [displayName, muted] = await Promise.all([
		accountSetting.get(
			accountConfigId,
			composeSettingName(ACCOUNT_OVERRIDE_NAMES.displayName, accountId),
		),
		accountSetting.get(
			accountConfigId,
			composeSettingName(ACCOUNT_OVERRIDE_NAMES.muted, accountId),
		),
	]);
	const overrides: AccountOverrides = {};
	const displayNameValue = displayName ? stringValueOf(displayName) : undefined;
	const mutedValue = muted ? mutedValueOf(muted) : undefined;
	if (displayNameValue !== undefined) overrides.displayName = displayNameValue;
	if (mutedValue !== undefined) overrides.muted = mutedValue;
	return overrides;
};

export const upsertAccountDisplayName = (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	accountId: string,
	displayName: string,
): Promise<unknown> =>
	accountSetting.upsert({
		accountConfigId,
		name: composeSettingName(ACCOUNT_OVERRIDE_NAMES.displayName, accountId),
		value: { kind: "String", value: displayName },
	});

/**
 * Set or clear the account mute flag. A `MutedFlag` upserts the row; `null`
 * deletes it (RFC 032: absence is "unset"). Mirrors the address-flag
 * null→remove, object→set semantics.
 */
export const writeAccountMuted = (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	accountId: string,
	muted: MutedFlag | null,
): Promise<unknown> => {
	const name = composeSettingName(ACCOUNT_OVERRIDE_NAMES.muted, accountId);
	if (muted === null) {
		return accountSetting.delete(accountConfigId, name);
	}
	return accountSetting.upsert({
		accountConfigId,
		name,
		value: { kind: "MutedFlag", value: muted },
	});
};

// ============================================
// Mailbox overrides (displayNameOverride + muted)
// ============================================

export const groupMailboxOverrides = (
	settings: AccountSettingItem[],
): Map<string, MailboxOverrides> => {
	const byMailbox = new Map<string, MailboxOverrides>();
	for (const setting of settings) {
		const mailboxId = targetIdOf(setting.name);
		if (!mailboxId) continue;
		const base = baseSettingName(setting.name);
		if (base === MAILBOX_OVERRIDE_NAMES.displayName) {
			const displayName = stringValueOf(setting);
			if (displayName === undefined) continue;
			const current = byMailbox.get(mailboxId) ?? {};
			current.displayNameOverride = displayName;
			byMailbox.set(mailboxId, current);
			continue;
		}
		if (base === MAILBOX_OVERRIDE_NAMES.muted) {
			const muted = mutedValueOf(setting);
			if (muted === undefined) continue;
			const current = byMailbox.get(mailboxId) ?? {};
			current.muted = muted;
			byMailbox.set(mailboxId, current);
		}
	}
	return byMailbox;
};

/**
 * Load every mailbox's overrides for an account configuration in one query,
 * grouped by mailboxId. listMailboxes uses this once to avoid an N+1 per mailbox.
 */
export const loadMailboxOverridesForConfig = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
): Promise<Map<string, MailboxOverrides>> => {
	const settings = await accountSetting.listByAccountConfig(accountConfigId);
	return groupMailboxOverrides(settings);
};

/**
 * Resolve one mailbox's overrides by reading just its two composite rows.
 * Used by getMailbox and the rename/PATCH handler.
 */
export const loadMailboxOverrides = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	mailboxId: string,
): Promise<MailboxOverrides> => {
	const [displayName, muted] = await Promise.all([
		accountSetting.get(
			accountConfigId,
			composeSettingName(MAILBOX_OVERRIDE_NAMES.displayName, mailboxId),
		),
		accountSetting.get(
			accountConfigId,
			composeSettingName(MAILBOX_OVERRIDE_NAMES.muted, mailboxId),
		),
	]);
	const overrides: MailboxOverrides = {};
	const displayNameValue = displayName ? stringValueOf(displayName) : undefined;
	const mutedValue = muted ? mutedValueOf(muted) : undefined;
	if (displayNameValue !== undefined)
		overrides.displayNameOverride = displayNameValue;
	if (mutedValue !== undefined) overrides.muted = mutedValue;
	return overrides;
};

/**
 * Apply a mailbox PATCH's override changes (displayNameOverride / muted) to
 * AccountSetting rows. For each field: `null` deletes the row, a value upserts
 * it, `undefined`/absent is a no-op — the same semantics the entity-backed
 * version used. The canonical role a folder fills is written separately via
 * `writeFolderRoleAppointment` (RFC 032 exclusive-folder-appointment, #976).
 */
export const applyMailboxOverrideChanges = async (
	accountSetting: Pick<IAccountSettingRepository, "upsert" | "delete">,
	accountConfigId: string,
	mailboxId: string,
	changes: {
		displayNameOverride?: string | null;
		muted?: MutedFlag | null;
	},
): Promise<void> => {
	const writes: Promise<unknown>[] = [];

	if (changes.displayNameOverride !== undefined) {
		const name = composeSettingName(
			MAILBOX_OVERRIDE_NAMES.displayName,
			mailboxId,
		);
		writes.push(
			changes.displayNameOverride === null
				? accountSetting.delete(accountConfigId, name)
				: accountSetting.upsert({
						accountConfigId,
						name,
						value: { kind: "String", value: changes.displayNameOverride },
					}),
		);
	}

	if (changes.muted !== undefined) {
		const name = composeSettingName(MAILBOX_OVERRIDE_NAMES.muted, mailboxId);
		writes.push(
			changes.muted === null
				? accountSetting.delete(accountConfigId, name)
				: accountSetting.upsert({
						accountConfigId,
						name,
						value: { kind: "MutedFlag", value: changes.muted },
					}),
		);
	}

	await Promise.all(writes);
};
