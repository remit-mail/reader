/**
 * Signals that a message was sent by a machine that does not read replies.
 *
 * Distinct from the bulk signals (`Precedence`, `List-Unsubscribe`): a platform
 * notification — an npm publish or 2FA mail, a CI result, a password reset —
 * carries none of those. It is a one-to-one message with an aligned DKIM
 * signature, so before issue #45 it reached the `personal` fallback and sat
 * alongside actual human correspondence.
 */

/**
 * From local-parts that mean "this mailbox is not read by a person". Matched
 * case-insensitively against the whole local-part with `.`, `_` and `-`
 * removed, so `no-reply`, `no_reply` and `noreply` are one entry.
 *
 * Deliberately excludes ambiguous, human-reachable local-parts (`support`,
 * `info`, `contact`, `hello`, `sales`): a person does answer those, and a
 * wrong entry here silently buries real mail in `automated`.
 */
const MACHINE_LOCAL_PARTS = new Set([
	"noreply",
	"donotreply",
	"nreply",
	"notification",
	"notifications",
	"notify",
	"automailer",
	"automated",
	"autoreply",
	"mailerdaemon",
	"postmaster",
	"bounce",
	"bounces",
	"alert",
	"alerts",
]);

/**
 * Headers only bulk/notification infrastructure sets. `Feedback-ID` is the
 * per-campaign identifier SES, Google and other ESPs attach to programmatic
 * sends; `X-Auto-Response-Suppress` tells the receiving client not to send
 * vacation replies back, which only a machine sender asks for.
 */
const MACHINE_HEADERS = ["feedback-id", "x-auto-response-suppress"];

const normalizeLocalPart = (localPart: string): string =>
	localPart.toLowerCase().replace(/[._-]/g, "");

/**
 * True when the From local-part is one of the known machine mailboxes, or
 * carries `noreply`/`donotreply` anywhere in it.
 *
 * Substring, not prefix: platforms qualify the mailbox on either side —
 * `noreply-github`, `messages-noreply`, `jobalerts-noreply`. No mailbox a
 * person answers spells "noreply" in its name, so the looser match costs
 * nothing.
 */
export const isMachineLocalPart = (localPart: string): boolean => {
	const normalized = normalizeLocalPart(localPart.split("+")[0]);
	if (MACHINE_LOCAL_PARTS.has(normalized)) return true;
	return normalized.includes("noreply") || normalized.includes("donotreply");
};

export const hasMachineHeader = (headerKeys: readonly string[]): boolean => {
	for (const key of headerKeys) {
		if (MACHINE_HEADERS.includes(key.toLowerCase())) return true;
	}
	return false;
};
