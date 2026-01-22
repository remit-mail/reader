export interface BaseEvent {
	accountId: string;
	eventId: string; // Idempotency key
	timestamp: number; // Unix timestamp
}

export interface SyncMailboxesEvent extends BaseEvent {
	type: "SYNC_MAILBOXES";
}

export interface SyncMessagesEvent extends BaseEvent {
	type: "SYNC_MESSAGES";
	mailboxId: string;
	fullSync?: boolean; // If true, ignore lastSyncUid
}

export interface SyncMessageBodyEvent extends BaseEvent {
	type: "SYNC_MESSAGE_BODY";
	mailboxId: string;
	messageIds: string[];
}

export interface SyncFlagsEvent extends BaseEvent {
	type: "SYNC_FLAGS";
	mailboxId: string;
	operations: Array<{
		messageId: string;
		flagName: string;
		operation: "add" | "remove";
	}>;
}

export interface MailboxCreateEvent extends BaseEvent {
	type: "MAILBOX_CREATE";
	mailboxId: string;
	path: string;
	subscribe?: boolean;
}

export interface MailboxRenameEvent extends BaseEvent {
	type: "MAILBOX_RENAME";
	mailboxId: string;
	oldPath: string;
	newPath: string;
}

export interface MailboxDeleteEvent extends BaseEvent {
	type: "MAILBOX_DELETE";
	mailboxId: string;
	path: string;
}

export type MailboxManagementEvent =
	| MailboxCreateEvent
	| MailboxRenameEvent
	| MailboxDeleteEvent;

export type ImapEvent =
	| SyncMailboxesEvent
	| SyncMessagesEvent
	| SyncMessageBodyEvent
	| SyncFlagsEvent
	| MailboxManagementEvent;
