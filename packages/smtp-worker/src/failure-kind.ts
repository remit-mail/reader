import type { MailFailureKind } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { SmtpConnectionError } from "@remit/smtp-service";

/**
 * Which class of failure ended an SMTP send, for the exported failure counter
 * (standalone-observability D3). `auth` is its own kind because it is the one
 * class that never resolves itself: an expired OAuth grant or a changed
 * password fails identically forever, and a mailbox that cannot send stays
 * unable to send until someone re-authorises it.
 */
export const smtpFailureKind = (error: unknown): MailFailureKind => {
	if (error instanceof RefreshTokenError) return "auth";
	if (error instanceof SmtpConnectionError) return error.kind;
	return "other";
};
