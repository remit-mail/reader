export interface Thread {
	threadId: string;
	mailboxId: string;
	subject: string;
	snippet: string;
	participants: string[];
	participantCount: number;
	messageCount: number;
	hasUnread: boolean;
	unreadCount: number;
	hasAttachments: boolean;
	isStarred: boolean;
	lastMessageAt: string;
	createdAt: string;
	updatedAt: string;
}

export interface Message {
	messageId: string;
	threadId: string;
	mailboxId: string;
	subject: string;
	from: EmailAddress;
	to: EmailAddress[];
	cc: EmailAddress[];
	bcc: EmailAddress[];
	snippet: string;
	isRead: boolean;
	isStarred: boolean;
	hasAttachments: boolean;
	attachments: Attachment[];
	receivedAt: string;
	createdAt: string;
	updatedAt: string;
}

export interface EmailAddress {
	name?: string;
	address: string;
}

export interface Attachment {
	attachmentId: string;
	messageId: string;
	filename: string;
	mimeType: string;
	size: number;
}

export interface Mailbox {
	mailboxId: string;
	accountId: string;
	name: string;
	fullPath: string;
	messageCount: number;
	unreadCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface Account {
	accountId: string;
	email: string;
	name?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PaginatedResponse<T> {
	data: T[];
	nextCursor?: string;
	hasMore: boolean;
}
