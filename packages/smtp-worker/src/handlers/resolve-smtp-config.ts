import type { AccountItem } from "@remit/remit-electrodb-service";
import {
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { SmtpConfig } from "@remit/smtp-service";

export interface SmtpConfigMissing {
	ok: false;
	reason: string;
}

export interface SmtpConfigResolved {
	ok: true;
	config: SmtpConfig;
}

export type ResolvedSmtpConfig = SmtpConfigResolved | SmtpConfigMissing;

/**
 * Resolve a SmtpConfig from a stored account.
 *
 * The web form treats "use different credentials for SMTP" as opt-in: when
 * disabled (the default), the IMAP password is reused for SMTP and no
 * smtpPasswordHash is persisted. The SMTP worker must mirror that, otherwise
 * sends fail with "SMTP not configured" for every account that uses the same
 * credentials for IMAP and SMTP (issue #163).
 *
 * - Missing smtpHost or smtpPort => account isn't configured for sending.
 * - Missing smtpPasswordHash => fall back to passwordHash (the IMAP secret).
 * - Missing smtpUsername => fall back to username (the IMAP login).
 */
export const resolveSmtpConfig = async (
	account: AccountItem,
	secrets: Pick<SecretsService, "decrypt">,
): Promise<ResolvedSmtpConfig> => {
	if (!account.smtpHost || !account.smtpPort) {
		return { ok: false, reason: "SMTP not configured for this account" };
	}

	const passwordHash = account.smtpPasswordHash ?? account.passwordHash;
	const smtpPassword = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(passwordHash)),
	);

	return {
		ok: true,
		config: {
			host: account.smtpHost,
			port: account.smtpPort,
			secure: account.smtpTls ?? false,
			auth: {
				user: account.smtpUsername ?? account.username,
				pass: smtpPassword,
			},
		},
	};
};
