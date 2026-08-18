export interface MailboxNameCandidate {
	mailboxId: string;
	fullPath: string;
	hierarchyDelimiter: string;
}

// A flat mailbox namespace reports no delimiter at all — ImapFlow gives `""`
// for a NIL LIST delimiter — and splitting on "" returns single characters, so
// the path is its own leaf.
const segments = (mailbox: MailboxNameCandidate): string[] =>
	mailbox.hierarchyDelimiter.length === 0
		? [mailbox.fullPath]
		: mailbox.fullPath.split(mailbox.hierarchyDelimiter);

const rank = (
	mailbox: MailboxNameCandidate,
	names: readonly string[],
): number | null => {
	const parts = segments(mailbox);
	const leaf = parts[parts.length - 1] ?? mailbox.fullPath;
	const nameIndex = names.indexOf(leaf.toLowerCase());
	if (nameIndex < 0) return null;
	// Depth outranks the name: a "Spam" buried under Trash or an archive must
	// never beat the account's real "Junk" one level up.
	return parts.length * names.length + nameIndex;
};

/**
 * A special-use folder by conventional name, for servers that advertise no
 * special-use flag for it. Matches the folder's own leaf segment against its
 * mailbox's own hierarchy delimiter, so it resolves at any depth under any
 * prefix (`INBOX/Spam`, `Mail.Junk E-mail`, `[Gmail]/Spam`) without knowing
 * which prefixes a server uses. `names` is ordered best-first and must be
 * lower case.
 */
export const resolveMailboxByLeafName = <T extends MailboxNameCandidate>(
	mailboxes: T[],
	names: readonly string[],
): T | null => {
	let best: { mailbox: T; rank: number } | null = null;
	for (const mailbox of mailboxes) {
		const candidate = rank(mailbox, names);
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
