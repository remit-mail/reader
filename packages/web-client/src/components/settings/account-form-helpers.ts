/**
 * Default SMTP defaults applied when auto-filling from IMAP at save time.
 *
 * STARTTLS on port 587 is the standard for almost every provider that
 * exposes both IMAP and SMTP under the same domain (Gmail, Fastmail,
 * Outlook, generic IMAP+SMTP hosts). Users with a different setup can
 * still override before saving — auto-fill never overwrites a value the
 * user already typed.
 */
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_TLS = false;
const DEFAULT_SMTP_STARTTLS = true;

/**
 * Derive an SMTP hostname from an IMAP hostname using the convention
 * `imap.example.com` -> `smtp.example.com`. If the host does not start
 * with the `imap.` prefix it is returned as-is so the caller can decide
 * whether to use it.
 */
export const deriveSmtpHostFromImap = (imapHost: string): string =>
	imapHost.replace(/^imap\./i, "smtp.");

interface SmtpAutoFillInput {
	imapHost: string;
	smtpHost?: string;
	smtpPort?: number;
	smtpTls?: boolean;
	smtpStartTls?: boolean;
}

interface SmtpAutoFillOutput {
	smtpHost: string;
	smtpPort: number;
	smtpTls: boolean;
	smtpStartTls: boolean;
}

/**
 * Compute the SMTP fields that should replace the user's current values
 * when the SMTP host is blank but IMAP is filled. Returns `null` when
 * no auto-fill should happen — either because the user already provided
 * an SMTP host (we never overwrite explicit input) or because IMAP is
 * also blank (nothing to derive from).
 */
export const computeSmtpAutoFill = (
	values: SmtpAutoFillInput,
): SmtpAutoFillOutput | null => {
	const smtpHostTrimmed = values.smtpHost?.trim() ?? "";
	if (smtpHostTrimmed.length > 0) return null;

	const imapHostTrimmed = values.imapHost.trim();
	if (imapHostTrimmed.length === 0) return null;

	return {
		smtpHost: deriveSmtpHostFromImap(imapHostTrimmed),
		smtpPort: DEFAULT_SMTP_PORT,
		smtpTls: DEFAULT_SMTP_TLS,
		smtpStartTls: DEFAULT_SMTP_STARTTLS,
	};
};

/**
 * `true` when a connection-test error message reads as an authentication
 * failure rather than a network/configuration problem. Mirrors the
 * keyword detection in the onboarding wizard so both surfaces agree on
 * what counts as "wrong credentials".
 */
export const isAuthError = (message: string | undefined): boolean => {
	const m = message?.toLowerCase() ?? "";
	return (
		m.includes("auth") ||
		m.includes("login") ||
		m.includes("535") ||
		m.includes("credential")
	);
};

/**
 * Append the per-provider app-password hint to an auth-failure error.
 * Preset providers reject the normal account password, which surfaces as
 * "wrong password"; the hint tells the user they need an app password.
 * Returns the original message unchanged when it is not an auth error.
 */
export const appendAppPasswordHint = (
	message: string | undefined,
	hint: string | undefined,
): string | undefined => {
	if (!message) return message;
	if (!hint) return message;
	if (!isAuthError(message)) return message;
	return `${message} — ${hint}`;
};

/**
 * `true` when an account row should display the "Can't send mail —
 * configure SMTP" warning. We treat both `undefined` and a blank string
 * as missing so accounts created before SMTP existed surface the same
 * affordance as new ones.
 */
export const accountIsMissingSmtp = (account: {
	smtpHost?: string | null;
}): boolean => {
	const host = account.smtpHost?.trim();
	return !host;
};
