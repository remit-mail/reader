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

export type ImapEvent =
	| SyncMailboxesEvent
	| SyncMessagesEvent
	| SyncMessageBodyEvent;
