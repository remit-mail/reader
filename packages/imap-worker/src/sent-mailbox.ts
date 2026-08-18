import type { MailboxItem } from "@remit/data-ports";

export type SentMailboxCandidate = Pick<
	MailboxItem,
	"mailboxId" | "fullPath" | "hierarchyDelimiter"
>;

const SENT_FOLDER_NAMES = [
	"sent",
	"sent items",
	"sent messages",
	"sent mail",
] as const;

// A flat mailbox namespace reports no delimiter at all — ImapFlow gives `""`
// for a NIL LIST delimiter — and splitting on "" returns single characters, so
// the path is its own leaf.
const segments = (mailbox: SentMailboxCandidate): string[] =>
	mailbox.hierarchyDelimiter.length === 0
		? [mailbox.fullPath]
		: mailbox.fullPath.split(mailbox.hierarchyDelimiter);

const rank = (mailbox: SentMailboxCandidate): number | null => {
	const parts = segments(mailbox);
	const leaf = parts[parts.length - 1] ?? mailbox.fullPath;
	const nameIndex = SENT_FOLDER_NAMES.indexOf(
		leaf.toLowerCase() as (typeof SENT_FOLDER_NAMES)[number],
	);
	if (nameIndex < 0) {
		return null;
	}
	// Depth outranks the name: a "Sent" buried under Trash or an archive must
	// never beat the account's real "Sent Items" one level up.
	return parts.length * SENT_FOLDER_NAMES.length + nameIndex;
};

/**
 * The Sent folder by conventional name, for servers that advertise no `\Sent`
 * special-use. Matches the folder's own leaf segment, so it resolves at any
 * depth under any prefix (`INBOX/Sent`, `Mail.Sent Items`, `[Gmail]/Sent Mail`)
 * without knowing which prefixes a server uses.
 */
export const resolveSentMailboxByName = (
	mailboxes: SentMailboxCandidate[],
): SentMailboxCandidate | null => {
	let best: { mailbox: SentMailboxCandidate; rank: number } | null = null;
	for (const mailbox of mailboxes) {
		const candidate = rank(mailbox);
		if (candidate === null) continue;
		if (
			!best ||
			candidate < best.rank ||
			(candidate === best.rank &&
				mailbox.fullPath.localeCompare(best.mailbox.fullPath) < 0)
		) {
			best = { mailbox, rank: candidate };
		}
	}
	return best?.mailbox ?? null;
};
