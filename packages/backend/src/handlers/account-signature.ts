import type {
	AccountSettingItem,
	IAccountSettingRepository,
} from "@remit/data-ports";
import {
	baseSettingName,
	composeSettingName,
	SETTING_NAME_SEPARATOR,
} from "@remit/data-ports/account-settings";

export interface AccountSignature {
	plainText?: string;
	html?: string;
}

const SIGNATURE_NAMES = {
	plainText: "AccountSignaturePlainText",
	html: "AccountSignatureHtml",
} as const;

const stringValueOf = (item: AccountSettingItem): string | undefined => {
	const { value } = item;
	if (value.kind === "String") return value.value;
	return undefined;
};

const accountIdOf = (name: string): string | undefined => {
	const idx = name.indexOf(SETTING_NAME_SEPARATOR);
	if (idx === -1) return undefined;
	return name.slice(idx + SETTING_NAME_SEPARATOR.length) || undefined;
};

/**
 * Build a per-account signature lookup from the whole settings set of one
 * account configuration. Signatures are stored as composite-named rows
 * (`AccountSignaturePlainText#<accountId>` / `AccountSignatureHtml#<accountId>`),
 * so one `listByAccountConfig` query yields every account's signature; this
 * groups them by the `#<accountId>` suffix.
 */
export const groupSignaturesByAccount = (
	settings: AccountSettingItem[],
): Map<string, AccountSignature> => {
	const byAccount = new Map<string, AccountSignature>();
	for (const setting of settings) {
		const accountId = accountIdOf(setting.name);
		if (!accountId) continue;
		const base = baseSettingName(setting.name);
		const text = stringValueOf(setting);
		if (text === undefined) continue;
		const current = byAccount.get(accountId) ?? {};
		if (base === SIGNATURE_NAMES.plainText) current.plainText = text;
		if (base === SIGNATURE_NAMES.html) current.html = text;
		byAccount.set(accountId, current);
	}
	return byAccount;
};

/**
 * Load every signature in an account configuration in one query, grouped by
 * account. Callers reading multiple accounts (GET /config) use this once.
 */
export const loadSignaturesForConfig = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
): Promise<Map<string, AccountSignature>> => {
	const settings = await accountSetting.listByAccountConfig(accountConfigId);
	return groupSignaturesByAccount(settings);
};

/**
 * Resolve the signature for a single account by reading just its two composite
 * rows. Used by the account create/update handlers, which act on one account.
 */
export const loadSignatureForAccount = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	accountId: string,
): Promise<AccountSignature> => {
	const [plain, html] = await Promise.all([
		accountSetting.get(
			accountConfigId,
			composeSettingName(SIGNATURE_NAMES.plainText, accountId),
		),
		accountSetting.get(
			accountConfigId,
			composeSettingName(SIGNATURE_NAMES.html, accountId),
		),
	]);
	const signature: AccountSignature = {};
	const plainText = plain ? stringValueOf(plain) : undefined;
	const htmlText = html ? stringValueOf(html) : undefined;
	if (plainText !== undefined) signature.plainText = plainText;
	if (htmlText !== undefined) signature.html = htmlText;
	return signature;
};

/**
 * Idempotent upsert of an account's signature fields. Only writes the parts the
 * caller supplied — an empty string is a valid stored value (it clears the
 * displayed signature without removing the row), matching the prior PATCH
 * semantics where setting `""` stored `""`.
 */
export const upsertAccountSignature = async (
	accountSetting: IAccountSettingRepository,
	accountConfigId: string,
	accountId: string,
	signature: { plainText?: string; html?: string },
): Promise<void> => {
	const writes: Promise<unknown>[] = [];
	if (signature.plainText !== undefined) {
		writes.push(
			accountSetting.upsert({
				accountConfigId,
				name: composeSettingName(SIGNATURE_NAMES.plainText, accountId),
				value: { kind: "String", value: signature.plainText },
			}),
		);
	}
	if (signature.html !== undefined) {
		writes.push(
			accountSetting.upsert({
				accountConfigId,
				name: composeSettingName(SIGNATURE_NAMES.html, accountId),
				value: { kind: "String", value: signature.html },
			}),
		);
	}
	await Promise.all(writes);
};
