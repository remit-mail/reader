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
 * case-insensitively against whole separator-delimited words, so `no-reply`,
 * `no_reply` and `noreply` are one entry.
 *
 * Deliberately excludes ambiguous, human-reachable local-parts (`support`,
 * `info`, `contact`, `hello`, `sales`): a person does answer those, and a
 * wrong entry here silently buries real mail in `automated`.
 */
const MACHINE_LOCAL_PARTS = new Set([
	"noreply",
	"donotreply",
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
 * Machine mailbox names that senders spell across separators. Joined into one
 * word before the local-part is split, so `no-reply` and `mailer.daemon` reduce
 * to a single token that {@link MACHINE_LOCAL_PARTS} can match.
 */
const SPELLED_OUT_MACHINE_NAMES: ReadonlyArray<[RegExp, string]> = [
	[/do-not-reply/g, "donotreply"],
	[/donot-reply/g, "donotreply"],
	[/no-reply/g, "noreply"],
	[/mailer-daemon/g, "mailerdaemon"],
	[/auto-reply/g, "autoreply"],
	[/auto-mailer/g, "automailer"],
];

/**
 * Headers only bulk/notification infrastructure sets. `Feedback-ID` is the
 * per-campaign identifier SES, Google and other ESPs attach to programmatic
 * sends; `X-Auto-Response-Suppress` tells the receiving client not to send
 * vacation replies back, which only a machine sender asks for.
 */
const MACHINE_HEADERS = ["feedback-id", "x-auto-response-suppress"];

/**
 * Split a local-part into its separator-delimited words, with the spelled-out
 * machine names joined back up first. The `+tag` suffix is dropped: it labels a
 * subaddress, never the mailbox.
 */
const toWords = (localPart: string): string[] => {
	let canonical = localPart.toLowerCase().split("+")[0].replace(/[._]/g, "-");
	for (const [pattern, replacement] of SPELLED_OUT_MACHINE_NAMES) {
		canonical = canonical.replace(pattern, replacement);
	}
	return canonical.split("-").filter(Boolean);
};

/**
 * True when any whole word of the From local-part is a known machine mailbox.
 *
 * Word-boundary, not substring: platforms qualify the mailbox on either side
 * (`noreply-github`, `messages-noreply`, `jobalerts-noreply`), so a bare prefix
 * test misses half of them — but a substring test reads `bruno.reply` as
 * "bru|noreply" and files a real person as `automated`. Splitting on the
 * separators the sender wrote catches the qualified forms without inventing a
 * match that spans two words.
 */
export const isMachineLocalPart = (localPart: string): boolean =>
	toWords(localPart).some((word) => MACHINE_LOCAL_PARTS.has(word));

export const hasMachineHeader = (headerKeys: readonly string[]): boolean => {
	for (const key of headerKeys) {
		if (MACHINE_HEADERS.includes(key.toLowerCase())) return true;
	}
	return false;
};
