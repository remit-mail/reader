import type { AccountItem } from "@remit/data-ports";
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
 * Resolved SMTP credentials — either a password or an OAuth2 access token.
 * Callers should obtain this via resolveConnectionCredentials from
 * @remit/mailbox-service (the single authType branch in the codebase).
 */
export type SmtpCredentials =
	| { kind: "password"; password: string }
	| { kind: "accessToken"; accessToken: string };

/**
 * Resolve a SmtpConfig from a stored account.
 *
 * Credential resolution (authType branching) is handled upstream by
 * resolveConnectionCredentials in @remit/mailbox-service. For OAuth
 * accounts the resolved access token is passed in via `credentials` and used
 * directly. For password accounts the credential is IGNORED here: SMTP must
 * honour the account's SMTP-specific password (`smtpPasswordHash`) when present,
 * which is distinct from the IMAP password the upstream resolver returns.
 *
 * The web form treats "use different credentials for SMTP" as opt-in: when
 * disabled (the default), the IMAP password is reused for SMTP and no
 * smtpPasswordHash is persisted. The SMTP worker must mirror that, otherwise
 * sends fail with "SMTP not configured" for every account that uses the same
 * credentials for IMAP and SMTP (issue #163).
 *
 * - `smtpEnabled` false => account isn't configured for sending (RFC 032 Tier 2:
 *   the explicit marker, not inferred from `smtpHost` presence).
 * - Missing smtpPasswordHash => fall back to passwordHash (the IMAP secret).
 * - Empty smtpUsername => fall back to username (the IMAP login).
 *
 * @param credentials - Pre-resolved credentials from resolveConnectionCredentials.
 *   Only the `accessToken` kind is consumed (OAuth accounts). For password
 *   accounts the SMTP-specific hash path always runs so per-SMTP passwords work.
 */
export const resolveSmtpConfig = async (
	account: AccountItem,
	secrets: Pick<SecretsService, "decrypt">,
	credentials?: SmtpCredentials,
): Promise<ResolvedSmtpConfig> => {
	if (!account.smtpEnabled) {
		return { ok: false, reason: "SMTP not configured for this account" };
	}

	const smtpHost = account.smtpHost ?? "";
	const smtpPort = account.smtpPort ?? 587;
	const smtpUser = account.smtpUsername || account.username;

	// OAuth accounts: use the pre-minted access token directly.
	if (credentials?.kind === "accessToken") {
		return {
			ok: true,
			config: {
				host: smtpHost,
				port: smtpPort,
				secure: account.smtpTls ?? false,
				user: smtpUser,
				credentials: {
					kind: "accessToken",
					accessToken: credentials.accessToken,
				},
			},
		};
	}

	// Password accounts: prefer the SMTP-specific secret, falling back to the
	// IMAP password hash (issue #163). The upstream password credential is the
	// IMAP password and must NOT override an account's separate SMTP password.
	const passwordHash = account.smtpPasswordHash ?? account.passwordHash;
	if (!passwordHash) {
		return { ok: false, reason: "No password configured for this account" };
	}
	const smtpPassword = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(passwordHash)),
	);

	return {
		ok: true,
		config: {
			host: smtpHost,
			port: smtpPort,
			secure: account.smtpTls ?? false,
			user: smtpUser,
			credentials: { kind: "password", password: smtpPassword },
		},
	};
};
