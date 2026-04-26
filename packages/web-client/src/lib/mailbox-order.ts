const SYSTEM_MAILBOX_ORDER: readonly string[][] = [
	["inbox"],
	["starred", "flagged"],
	["drafts", "draft"],
	["sent", "sent mail", "sent items", "sent messages"],
	["archive", "archives"],
	["all", "all mail"],
	["spam", "junk"],
	["trash", "bin", "deleted", "deleted items"],
];

export const NON_SYSTEM_PRIORITY = SYSTEM_MAILBOX_ORDER.length;

export const getMailboxDisplayName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return parts[parts.length - 1] || fullPath;
};

export const getMailboxPriority = (fullPath: string): number => {
	if (fullPath.includes("/")) return NON_SYSTEM_PRIORITY;
	const name = getMailboxDisplayName(fullPath).toLowerCase();
	for (let i = 0; i < SYSTEM_MAILBOX_ORDER.length; i++) {
		if (SYSTEM_MAILBOX_ORDER[i].includes(name)) return i;
	}
	return NON_SYSTEM_PRIORITY;
};

export const isSystemMailbox = (fullPath: string): boolean =>
	getMailboxPriority(fullPath) < NON_SYSTEM_PRIORITY;

interface MailboxLike {
	mailboxId: string;
	fullPath: string;
}

const SPECIAL_USE_ALIASES: Record<string, string> = {
	trash: "trash",
	bin: "trash",
	deleted: "trash",
	"deleted items": "trash",
	drafts: "drafts",
	draft: "drafts",
	sent: "sent",
	"sent mail": "sent",
	"sent items": "sent",
	"sent messages": "sent",
	junk: "junk",
	spam: "junk",
	archive: "archive",
	archives: "archive",
	all: "all",
	"all mail": "all",
};

// Canonical-name preference per special-use type. When multiple top-level
// mailboxes resolve to the same type (e.g. Dovecot exposes both "Sent" and
// "Sent Messages"), pick the first match in this order. Names not listed
// fall through to the IMAP-server-provided ordering as a final tiebreaker.
const SPECIAL_USE_PREFERRED_NAMES: Record<string, string[]> = {
	sent: ["sent", "sent mail", "sent items", "sent messages"],
	drafts: ["drafts", "draft"],
	trash: ["trash", "bin", "deleted", "deleted items"],
	junk: ["junk", "spam"],
	archive: ["archive", "archives"],
	all: ["all mail", "all"],
};

const pickPreferredForType = <T extends MailboxLike>(
	candidates: T[],
	type: string,
): T => {
	const preferred = SPECIAL_USE_PREFERRED_NAMES[type] ?? [];
	for (const name of preferred) {
		const match = candidates.find(
			(m) => getMailboxDisplayName(m.fullPath).toLowerCase() === name,
		);
		if (match) return match;
	}
	return candidates[0];
};

/**
 * Drop duplicate special-use mailboxes (issue #178).
 *
 * Two flavours of duplicate exist in the wild:
 *  - Prefixed (`[Gmail]/Sent Mail` alongside `Sent`): keep the top-level one.
 *  - Top-level twins (`Sent` AND `Sent Messages`, common on Dovecot
 *    fixtures): keep the canonical name from `SPECIAL_USE_PREFERRED_NAMES`.
 *
 * Custom (label) mailboxes are passed through untouched.
 */
export const filterDuplicateSpecialUse = <T extends MailboxLike>(
	mailboxes: T[],
): T[] => {
	const prefixedSpecialUse = new Set<string>();
	for (const mailbox of mailboxes) {
		const name = getMailboxDisplayName(mailbox.fullPath).toLowerCase();
		const specialUseType = SPECIAL_USE_ALIASES[name];
		if (mailbox.fullPath.includes("/") && specialUseType) {
			prefixedSpecialUse.add(specialUseType);
		}
	}

	const topLevelByType = new Map<string, T[]>();
	for (const mailbox of mailboxes) {
		if (mailbox.fullPath.includes("/")) continue;
		const name = getMailboxDisplayName(mailbox.fullPath).toLowerCase();
		const specialUseType = SPECIAL_USE_ALIASES[name];
		if (!specialUseType) continue;
		const list = topLevelByType.get(specialUseType) ?? [];
		list.push(mailbox);
		topLevelByType.set(specialUseType, list);
	}
	const keepIds = new Set<string>();
	for (const [type, candidates] of topLevelByType) {
		keepIds.add(pickPreferredForType(candidates, type).mailboxId);
	}

	return mailboxes.filter((mailbox) => {
		const name = getMailboxDisplayName(mailbox.fullPath).toLowerCase();
		const specialUseType = SPECIAL_USE_ALIASES[name];
		if (!specialUseType) return true;
		if (mailbox.fullPath.includes("/")) return true;
		if (prefixedSpecialUse.has(specialUseType)) return false;
		return keepIds.has(mailbox.mailboxId);
	});
};
