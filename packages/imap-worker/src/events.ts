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
	/**
	 * Set on a continuation event (the "next batch" a batch emits when it drains
	 * only part of a mailbox). Carries the batch's remaining-message count so the
	 * FIFO deduplication id is distinct per batch — otherwise every continuation
	 * for a mailbox shares one dedup id and the 5-minute window silently drops
	 * batches 2..N, capping any mailbox over one batch. The value is not used by
	 * the handler (the resume point comes from the persisted watermark); it only
	 * makes the dedup id unique.
	 */
	resumeCursor?: number;
}

/**
 * A message to body-sync, carrying the UID resolved at envelope-sync time so
 * the consumer can issue one ranged FETCH without a per-message DDB lookup.
 */
export interface SyncMessageBodyTarget {
	messageId: string;
	uid: number;
}

export interface SyncMessageBodyEvent extends BaseEvent {
	type: "SYNC_MESSAGE_BODY";
	mailboxId: string;
	/**
	 * Message ids to sync. Always present for backward compatibility; the
	 * consumer falls back to this list (looking up each UID) when `messages`
	 * is absent.
	 */
	messageIds: string[];
	/**
	 * Preferred shape: messageId+uid pairs. When present, the consumer skips the
	 * per-message UID lookup and fetches the whole batch in one ranged FETCH.
	 * Optional so older in-flight events (ids only) still process.
	 */
	messages?: SyncMessageBodyTarget[];
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

/**
 * Event for deleting a message (move to trash or permanent delete).
 */
export interface MessageDeleteEvent extends BaseEvent {
	type: "MESSAGE_DELETE";
	messageId: string;
	mailboxId: string;
	mailboxPath: string;
	uid: number;
	operation: "move_to_trash" | "permanent_delete";
	destinationMailboxId?: string;
	destinationMailboxPath?: string;
}

/**
 * Event for moving a message to another mailbox.
 */
export interface MessageMoveEvent extends BaseEvent {
	type: "MESSAGE_MOVE";
	messageId: string;
	sourceMailboxId: string;
	sourceMailboxPath: string;
	destinationMailboxId: string;
	destinationMailboxPath: string;
	uid: number;
}

/**
 * Event for emptying the Trash mailbox.
 */
export interface EmptyTrashEvent extends BaseEvent {
	type: "EMPTY_TRASH";
	trashMailboxId: string;
	trashMailboxPath: string;
}

/**
 * Event for copying a message to another mailbox.
 */
export interface MessageCopyEvent extends BaseEvent {
	type: "MESSAGE_COPY";
	sourceMessageId: string;
	newMessageId: string;
	sourceMailboxId: string;
	sourceMailboxPath: string;
	destinationMailboxId: string;
	destinationMailboxPath: string;
	uid: number;
}

/**
 * Event for appending a sent message to the Sent mailbox via IMAP APPEND.
 */
export interface AppendSentMessageEvent extends BaseEvent {
	type: "APPEND_SENT_MESSAGE";
	outboxMessageId: string;
}

export interface DeleteAccountObjectsEvent {
	type: "DELETE_ACCOUNT_OBJECTS";
	accountConfigId: string;
	continuationToken?: string;
}

/**
 * Sent by the account-deletion fanout worker once per accountId under a
 * deleted AccountConfig. The actual stop semantics already happen via the
 * account-tombstone fence (`isActive=false` + `deletedAt`) flipped by the
 * deletion API: any in-flight or future event for the account is dropped
 * by `isAccountDeleted`. This event exists as an explicit signal in the
 * cascade contract — when the imap-worker grows real per-account drain or
 * connection-teardown semantics it hangs off this hook.
 */
export interface ImapWorkerStopEvent {
	type: "IMAP_WORKER_STOP";
	accountConfigId: string;
	accountId: string;
}

/** Union of all event types the worker can process (including non-IMAP ones). */
export type WorkerEvent =
	| ImapEvent
	| DeleteAccountObjectsEvent
	| ImapWorkerStopEvent;

export type MessageManagementEvent =
	| MessageDeleteEvent
	| MessageMoveEvent
	| EmptyTrashEvent
	| MessageCopyEvent;

export type ImapEvent =
	| SyncMailboxesEvent
	| SyncMessagesEvent
	| SyncMessageBodyEvent
	| SyncFlagsEvent
	| MailboxManagementEvent
	| MessageManagementEvent
	| AppendSentMessageEvent;
