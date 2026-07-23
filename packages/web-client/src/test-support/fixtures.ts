/**
 * Fully-shaped API fixtures. Lives outside `src/` so it is not measured for
 * coverage. Every builder returns a complete generated type — no casts at the
 * call sites, so a contract change surfaces here once instead of in every test.
 */

import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";

export const makeMailbox = (
	overrides: Partial<RemitImapMailboxResponse> & {
		mailboxId: string;
		fullPath: string;
	},
): RemitImapMailboxResponse => ({
	accountId: "acc-1",
	namespaceType: "personal",
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: 0,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

export const makeAccount = (
	overrides: Partial<RemitImapAccountResponse> & { accountId: string },
): RemitImapAccountResponse => ({
	accountConfigId: "cfg-1",
	username: "alice@example.com",
	email: "alice@example.com",
	authType: "password",
	imapHost: "imap.example.com",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	smtpEnabled: true,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpTls: false,
	smtpStartTls: true,
	smtpUsername: "alice@example.com",
	isActive: true,
	connectionState: "authenticated",
	createdAt: 0,
	updatedAt: 0,
	folderAppointments: [],
	...overrides,
});

export const makeThreadMessage = (
	overrides: Partial<RemitImapThreadMessageResponse> & {
		messageId: string;
	},
): RemitImapThreadMessageResponse => ({
	threadId: "thread-1",
	threadMessageId: `tm-${overrides.messageId}`,
	accountConfigId: "cfg-1",
	mailboxId: "mbx-inbox",
	accountId: "acc-1",
	subject: "Quarterly report",
	fromName: "Alice",
	fromEmail: "alice@example.com",
	sentDate: 1_767_225_600_000,
	snippet: "",
	isRead: false,
	hasAttachment: false,
	star: "none",
	hasStars: false,
	isDeleted: false,
	senderTrust: "unknown",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});
