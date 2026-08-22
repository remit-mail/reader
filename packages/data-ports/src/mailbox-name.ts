export interface MailboxPath {
	fullPath: string;
	hierarchyDelimiter: string;
}

export interface MailboxNameCandidate extends MailboxPath {
	mailboxId: string;
}

// A flat mailbox namespace reports no delimiter at all — ImapFlow gives `""`
// for a NIL LIST delimiter — and splitting on "" returns single characters, so
// the path is its own leaf.
const segments = (mailbox: MailboxPath): string[] =>
	mailbox.hierarchyDelimiter.length === 0
		? [mailbox.fullPath]
		: mailbox.fullPath.split(mailbox.hierarchyDelimiter);

/**
 * The folder's own name: the last segment of its path under the delimiter its
 * own server reports (`INBOX/Spam` → `Spam`, `INBOX.Projects.Q3` → `Q3`).
 */
export const mailboxLeafName = (mailbox: MailboxPath): string => {
	const parts = segments(mailbox);
	return parts[parts.length - 1] || mailbox.fullPath;
};

const rank = (
	mailbox: MailboxNameCandidate,
	names: readonly string[],
): number | null => {
	const parts = segments(mailbox);
	const nameIndex = names.indexOf(mailboxLeafName(mailbox).toLowerCase());
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
	mailboxes: readonly T[],
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
