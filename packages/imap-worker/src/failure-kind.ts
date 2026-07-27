import type { MailFailureKind } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { MailConnectionError } from "@remit/mailbox-service";

/**
 * Which class of failure ended an IMAP operation, for the exported failure
 * counter (standalone-observability D3). `auth` is its own kind because it is
 * the one class that never resolves itself — an expired OAuth grant or a
 * changed password fails identically forever, and it is the most common way a
 * self-hosted mailbox goes quiet. A refresh that cannot mint a token is the
 * same condition arriving one layer earlier.
 */
export const imapFailureKind = (error: unknown): MailFailureKind => {
	if (error instanceof RefreshTokenError) return "auth";
	if (error instanceof MailConnectionError) return error.kind;
	return "other";
};
