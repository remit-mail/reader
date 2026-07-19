import type {
	AccountResponse,
	FolderAppointment,
} from "@remit/api-openapi-types";
import type { AccountItem } from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { AccountAuthType } from "@remit/domain-enums";
import type { AccountOverrides } from "./account-overrides.js";
import type { AccountSignature } from "./account-signature.js";

/**
 * Natural key identifying "the same mailbox in the same place" within an
 * account config. IMAP host and login username are both case-insensitive, so we
 * fold to lowercase before comparing. Used as the explicit server-side
 * uniqueness key now that message identity is account-scoped (entropy per
 * onboard) and no longer incidentally dedups duplicate onboards (#633/#635).
 */
export interface MailboxNaturalKey {
	imapHost: string;
	username: string;
}

const mailboxKeyOf = (key: MailboxNaturalKey): string =>
	`${key.imapHost.toLowerCase()}\u0000${key.username.toLowerCase()}`;

/**
 * Find an existing ACTIVE (non-deleted) account that occupies the same
 * mailbox-in-the-same-place as `key`. Soft-deleted accounts are ignored so a
 * re-onboard after delete still succeeds.
 *
 * Callers pass the accounts already scoped to one account config (the natural
 * key's accountConfigId component), so this only matches on host + username.
 */
export const findActiveDuplicateMailbox = (
	existing: AccountItem[],
	key: MailboxNaturalKey,
): AccountItem | undefined => {
	const target = mailboxKeyOf(key);
	return existing.find(
		(account) =>
			!account.deletedAt &&
			mailboxKeyOf({
				imapHost: account.imapHost,
				username: account.username,
			}) === target,
	);
};

/**
 * Reject the create when an active account already onboards the same mailbox in
 * the same place. Surfaces as a typed 409 ConflictError so the web-client can
 * show a "already added" message instead of silently creating a duplicate.
 */
export const assertNoDuplicateMailbox = (
	existing: AccountItem[],
	key: MailboxNaturalKey,
): void => {
	const duplicate = findActiveDuplicateMailbox(existing, key);
	if (!duplicate) return;
	throw new ConflictError(
		`An account for ${key.username} on ${key.imapHost} already exists`,
	);
};

/** Rejects OAuth accounts that must go through the dedicated connect flow. */
export const assertNotOAuthCreate = (authType: string | undefined): void => {
	if (authType === AccountAuthType.OauthMicrosoft) {
		throw Object.assign(new Error("Bad Request"), {
			status: 400,
			message:
				"OAuth accounts must be created via the OAuth connect flow (POST /accounts/oauth/microsoft/start)",
		});
	}
};

/** Rejects password-auth account creation when no password is supplied. */
export const assertPasswordProvided = (
	authType: string | undefined,
	password: string | undefined,
): void => {
	const isPasswordAuth = authType === AccountAuthType.Password || !authType;
	if (isPasswordAuth && !password) {
		throw Object.assign(new Error("Bad Request"), {
			status: 400,
			message:
				"password is required when authType is 'password' (or when authType is omitted)",
		});
	}
};

// SECURITY: passwordHash, oauthRefreshTokenHash, and smtpPasswordHash are
// intentionally omitted — never expose token material in API responses.
// Display name, mute flag, and signatures live in per-account AccountSetting
// rows (RFC 032); the caller resolves them and passes them in. Absent means the
// override is unset. `folderAppointments` (RFC 032 exclusive-folder-appointment,
// #976) is resolved the same way — persisted rows merged with server-proposed
// defaults for any unfilled role — via `resolveFolderAppointments`.
export const toAccountResponse = (
	account: AccountItem,
	signature: AccountSignature = {},
	overrides: AccountOverrides = {},
	folderAppointments: FolderAppointment[] = [],
): AccountResponse => ({
	accountId: account.accountId,
	accountConfigId: account.accountConfigId,
	displayName: overrides.displayName,
	username: account.username,
	email: account.email,
	authType: account.authType ?? AccountAuthType.Password,
	imapHost: account.imapHost,
	imapPort: account.imapPort,
	imapTls: account.imapTls,
	imapStartTls: account.imapStartTls,
	// RFC 032 Tier 2: SMTP config is total. ElectroDB `default` applies on write
	// only, so rows written before this change still lack these attributes —
	// coalesce to the schema defaults on read so the response is always complete.
	smtpEnabled: account.smtpEnabled ?? false,
	smtpHost: account.smtpHost ?? "",
	smtpPort: account.smtpPort ?? 587,
	smtpTls: account.smtpTls ?? false,
	smtpStartTls: account.smtpStartTls ?? true,
	smtpUsername: account.smtpUsername ?? "",
	signaturePlainText: signature.plainText,
	signatureHtml: signature.html,
	isActive: account.isActive,
	connectionState: account.connectionState,
	lastConnectedAt: account.lastConnectedAt,
	lastSyncAt: account.lastSyncAt,
	lastError: account.lastError,
	syncPhase: account.syncPhase,
	mailboxCountTotal: account.mailboxCountTotal,
	mailboxCountSynced: account.mailboxCountSynced,
	muted: overrides.muted,
	createdAt: account.createdAt,
	updatedAt: account.updatedAt,
	folderAppointments,
});
