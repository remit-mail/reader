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

export interface FetchBodyEvent extends BaseEvent {
	type: "FETCH_BODY";
	mailboxId: string;
	messageId: string;
}

export interface UpdateFlagsEvent extends BaseEvent {
	type: "UPDATE_FLAGS";
	mailboxId: string;
	messageId: string;
	addFlags?: string[];
	removeFlags?: string[];
}

export type ImapEvent =
	| SyncMailboxesEvent
	| SyncMessagesEvent
	| FetchBodyEvent
	| UpdateFlagsEvent;
