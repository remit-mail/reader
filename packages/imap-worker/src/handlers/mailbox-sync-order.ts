import { MailboxSpecialUse } from "@remit/domain-enums";

export type MailboxSyncOrderEntry = {
	mailboxId: string;
	fullPath: string;
	specialUse?: readonly string[];
};

// Sync priority by special-use, lowest first. Real mail leads (INBOX, then
// Sent and Drafts), normal folders sit in the middle at NORMAL_PRIORITY, and
// the low-value bulk folders (Junk/Spam, Trash) are pushed to the end so a
// fresh account fills its inbox before its spam (issue #567). Keyed by the
// bare runtime values from `@remit/domain-enums` (e.g. "Junk"), which match the
// values stored in the Mailbox `specialUse` DynamoDB set.
const INBOX_PRIORITY = 0;
const NORMAL_PRIORITY = 4;

const SPECIAL_USE_PRIORITY: Record<string, number> = {
	[MailboxSpecialUse.Sent]: 1,
	[MailboxSpecialUse.Drafts]: 2,
	[MailboxSpecialUse.Flagged]: 3,
	[MailboxSpecialUse.Junk]: 5,
	[MailboxSpecialUse.Trash]: 6,
};

const isInbox = (fullPath: string): boolean =>
	fullPath.toUpperCase() === "INBOX";

/**
 * Sync priority for a single mailbox. INBOX always leads; otherwise the
 * mailbox's special-use flags resolve to a priority, defaulting to
 * NORMAL_PRIORITY for plain user folders and unflagged mailboxes. When a
 * mailbox carries both a leading flag (Sent/Drafts) and a trailing one
 * (Junk/Trash) — rare, but possible with misconfigured servers — the trailing
 * one wins: de-prioritising a bulk folder is the safer first-impression
 * choice.
 */
export const mailboxSyncPriority = (entry: MailboxSyncOrderEntry): number => {
	if (isInbox(entry.fullPath)) return INBOX_PRIORITY;

	const priorities = (entry.specialUse ?? [])
		.map((flag) => SPECIAL_USE_PRIORITY[flag])
		.filter((priority): priority is number => priority !== undefined);

	if (priorities.length === 0) return NORMAL_PRIORITY;

	const trailing = priorities.filter((priority) => priority > NORMAL_PRIORITY);
	if (trailing.length > 0) return Math.max(...trailing);

	return Math.min(...priorities);
};

/**
 * Order mailboxes for sync fan-out: INBOX first, then Sent/Drafts, then normal
 * folders, with Junk/Spam and Trash last. Ties break alphabetically by
 * fullPath so the order is deterministic.
 */
export const orderMailboxesForSync = <T extends MailboxSyncOrderEntry>(
	mailboxes: readonly T[],
): T[] =>
	[...mailboxes].sort((a, b) => {
		const priorityDelta = mailboxSyncPriority(a) - mailboxSyncPriority(b);
		if (priorityDelta !== 0) return priorityDelta;
		return a.fullPath.localeCompare(b.fullPath);
	});
