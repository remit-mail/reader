import type { AccountItem } from "@remit/remit-electrodb-service";
import { AccountAuthType } from "@remit/domain-enums";
import type { AccountResponse } from "@remit/api-openapi-types";

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
export const toAccountResponse = (account: AccountItem): AccountResponse => ({
	accountId: account.accountId,
	accountConfigId: account.accountConfigId,
	username: account.username,
	email: account.email,
	authType: account.authType ?? AccountAuthType.Password,
	imapHost: account.imapHost,
	imapPort: account.imapPort,
	imapTls: account.imapTls,
	imapStartTls: account.imapStartTls,
	smtpHost: account.smtpHost,
	smtpPort: account.smtpPort,
	smtpTls: account.smtpTls,
	smtpStartTls: account.smtpStartTls,
	smtpUsername: account.smtpUsername,
	signaturePlainText: account.signaturePlainText,
	signatureHtml: account.signatureHtml,
	isActive: account.isActive,
	connectionState: account.connectionState,
	lastConnectedAt: account.lastConnectedAt,
	lastSyncAt: account.lastSyncAt,
	lastError: account.lastError,
	syncPhase: account.syncPhase,
	mailboxCountTotal: account.mailboxCountTotal,
	mailboxCountSynced: account.mailboxCountSynced,
	muted: account.muted,
	createdAt: account.createdAt,
	updatedAt: account.updatedAt,
});
