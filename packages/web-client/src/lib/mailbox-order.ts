const SYSTEM_MAILBOX_ORDER: readonly string[][] = [
	["inbox"],
	["starred", "flagged"],
	["drafts", "draft"],
	["outbox"],
	["sent", "sent mail", "sent items"],
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
