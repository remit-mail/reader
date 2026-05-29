import type { MailboxResponse } from "@remit/api-openapi-types";

const accountId = "acc_0f9c1a20-7b3e-4d11-9c2a-2e6f0a1b2c3d";
const base = {
	accountId,
	namespaceType: "personal" as const,
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	deletedCount: 0,
	createdAt: Date.UTC(2025, 0, 3) / 1000,
	updatedAt: Date.UTC(2026, 4, 29) / 1000,
};

/** Folder list for the left pane, typed against generated MailboxResponse. */
export const mailboxes: MailboxResponse[] = [
	{
		...base,
		mailboxId: "mbx_inbox",
		fullPath: "INBOX",
		messageCount: 128,
		unseenCount: 6,
	},
	{
		...base,
		mailboxId: "mbx_flagged",
		fullPath: "Flagged",
		messageCount: 4,
		unseenCount: 0,
		specialUse: ["Flagged"],
	},
	{
		...base,
		mailboxId: "mbx_sent",
		fullPath: "Sent",
		messageCount: 312,
		unseenCount: 0,
		specialUse: ["Sent"],
	},
	{
		...base,
		mailboxId: "mbx_drafts",
		fullPath: "Drafts",
		messageCount: 2,
		unseenCount: 0,
		specialUse: ["Drafts"],
	},
	{
		...base,
		mailboxId: "mbx_archive",
		fullPath: "Archive",
		messageCount: 1894,
		unseenCount: 0,
		specialUse: ["Archive"],
	},
	{
		...base,
		mailboxId: "mbx_junk",
		fullPath: "Junk",
		messageCount: 17,
		unseenCount: 17,
		specialUse: ["Junk"],
	},
	{
		...base,
		mailboxId: "mbx_trash",
		fullPath: "Trash",
		messageCount: 41,
		unseenCount: 0,
		specialUse: ["Trash"],
	},
];

export const inboxId = "mbx_inbox";
