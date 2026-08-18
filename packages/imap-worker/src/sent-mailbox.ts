import type { MailboxItem } from "@remit/data-ports";

export type SentMailboxCandidate = Pick<
	MailboxItem,
	"mailboxId" | "fullPath" | "hierarchyDelimiter"
>;

const SENT_FOLDER_NAMES = [
	"Sent",
	"Sent Items",
	"Sent Messages",
	"Sent Mail",
] as const;

const leafName = (mailbox: SentMailboxCandidate): string => {
	const parts = mailbox.fullPath.split(mailbox.hierarchyDelimiter);
	return parts[parts.length - 1] ?? mailbox.fullPath;
};

const depth = (mailbox: SentMailboxCandidate): number =>
	mailbox.fullPath.split(mailbox.hierarchyDelimiter).length;

const shallowestFirst = (
	a: SentMailboxCandidate,
	b: SentMailboxCandidate,
): number => depth(a) - depth(b) || a.fullPath.localeCompare(b.fullPath);

export const resolveSentMailboxByName = (
	mailboxes: SentMailboxCandidate[],
): SentMailboxCandidate | null => {
	for (const name of SENT_FOLDER_NAMES) {
		const matches = mailboxes
			.filter((m) => leafName(m).toLowerCase() === name.toLowerCase())
			.sort(shallowestFirst);
		const found = matches[0];
		if (found) {
			return found;
		}
	}
	return null;
};
