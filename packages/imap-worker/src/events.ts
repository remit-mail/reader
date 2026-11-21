import type {
	EmptyTrashEventV3,
	MessageCopyEventV3,
	MessageDeleteEventV3,
	MessageMoveEventV3,
	MUTATION_EVENT_SCHEMA_VERSION,
} from "@remit/data-ports/mutation-events";

export type {
	EmptyTrashEventV3,
	MessageCopyEventV3,
	MessageDeleteEventV3,
	MessageMoveEventV3,
} from "@remit/data-ports/mutation-events";

export interface BaseEvent {
	accountId: string;
	eventId: string; // Idempotency key
	timestamp: number; // Unix timestamp
}

export interface SyncMailboxesEvent extends BaseEvent {
	type: "SYNC_MAILBOXES";
	/**
	 * Set by POST /sync — the only trigger a person asks for by name. It makes
	 * the fan-out sync every mailbox, skipping the freshness gate that keeps
	 * incidental triggers (config load, OAuth connect, the scheduled tick) from
	 * re-enumerating folders that were just enumerated.
	 */
	explicitRequest?: boolean;
}

export interface SyncMessagesEvent extends BaseEvent {
	type: "SYNC_MESSAGES";
	mailboxId: string;
	fullSync?: boolean; // If true, ignore lastSyncUid
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
	/**
	 * Set only by the read-miss re-arm cue (`BodySyncQueueService.requestBodySync`,
	 * called when a `/content` read finds `bodyStorageKey` set but the storage
	 * object missing). Tells the consumer to bypass the "already stored" skip
	 * guard and re-fetch + rewrite the body even though the DB row already
	 * carries a `bodyStorageKey` — otherwise stale metadata (key set, object
	 * gone) makes the read-miss retry loop forever, since the bulk skip guard
	 * would keep treating the message as already synced. Optional so older
	 * in-flight events (no force) keep the original skip behavior.
	 */
	force?: boolean;
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
	/** Refuse the delete while the mail server still holds mail in the folder. */
	requireEmpty: boolean;
	/** Move everything the server holds in the folder here before the delete. */
	moveMailTo: string | null;
}

export type MailboxManagementEvent =
	| MailboxCreateEvent
	| MailboxRenameEvent
	| MailboxDeleteEvent;

/**
 * Event for deleting a message (move to trash or permanent delete).
 */
export interface MessageDeleteEventV2
	extends Omit<MessageDeleteEventV3, "schemaVersion"> {
	schemaVersion: typeof MUTATION_EVENT_SCHEMA_VERSION;
	mailboxPath: string;
	destinationMailboxPath?: string;
}

export type MessageDeleteEvent = MessageDeleteEventV2 | MessageDeleteEventV3;

/**
 * Event for moving a message to another mailbox.
 */
export interface MessageMoveEventV1
	extends Omit<MessageMoveEventV3, "schemaVersion"> {
	schemaVersion?: undefined;
	sourceMailboxPath: string;
	destinationMailboxPath: string;
}

export type MessageMoveEvent = MessageMoveEventV1 | MessageMoveEventV3;

/**
 * Event for emptying the Trash mailbox.
 */
export interface EmptyTrashEventV2
	extends Omit<EmptyTrashEventV3, "schemaVersion"> {
	schemaVersion: typeof MUTATION_EVENT_SCHEMA_VERSION;
	trashMailboxPath: string;
}

export type EmptyTrashEvent = EmptyTrashEventV2 | EmptyTrashEventV3;

/**
 * Event for copying a message to another mailbox.
 */
export interface MessageCopyEventV1
	extends Omit<MessageCopyEventV3, "schemaVersion"> {
	schemaVersion?: undefined;
	sourceMailboxPath: string;
	destinationMailboxPath: string;
}

export type MessageCopyEvent = MessageCopyEventV1 | MessageCopyEventV3;

/**
 * Event for appending a sent message to the Sent mailbox via IMAP APPEND.
 */
export interface AppendSentMessageEvent extends BaseEvent {
	type: "APPEND_SENT_MESSAGE";
	outboxMessageId: string;
}

/**
 * Drains one pending placement-move marker (issue #1271, epic #1281) to
 * IMAP. Deliberately carries no UID and no destination — both are resolved
 * fresh from the Message row and the `MessagePlacementMove` marker at push
 * time (epic invariant 1), so this event stays valid across any amount of
 * queue delay or an unrelated UIDVALIDITY rebuild (#1272). If the marker is
 * gone by the time this is processed (confirmed, superseded, or an external
 * delete already reconciled it), the handler is a no-op.
 */
export interface PlacementMovePushEvent extends BaseEvent {
	type: "PLACEMENT_MOVE_PUSH";
	accountConfigId: string;
	messageId: string;
}

/**
 * Wake-up hint for one pending flag-push marker (issue #1273, epic #1281).
 * Carries only our message id + the flag field — never a UID and never the
 * desired add/remove transition (both live on the `MessageFlagPush` marker,
 * resolved fresh at push time, epic invariant 1). Produced two ways: by
 * `FlagPushService` (remit-mailbox-service) right after a user's flag flip
 * commits locally, and by the periodic per-mailbox sync tick
 * (`sync-messages.ts`) re-arming any marker it finds still stuck `pending`
 * (a prior enqueue that never landed). If the marker is gone or has moved
 * past `pending` by the time this is processed, the handler is a no-op.
 */
export interface FlagPushEvent extends BaseEvent {
	type: "FLAG_PUSH";
	accountConfigId: string;
	messageId: string;
	flagName: string;
}

export interface DeleteAccountObjectsEvent {
	type: "DELETE_ACCOUNT_OBJECTS";
	accountConfigId: string;
	continuationToken?: string;
}

/** Union of all event types the worker can process (including non-IMAP ones). */
export type WorkerEvent = ImapEvent | DeleteAccountObjectsEvent;

export type MessageManagementEvent =
	| MessageDeleteEvent
	| MessageMoveEvent
	| EmptyTrashEvent
	| MessageCopyEvent;

export type ImapEvent =
	| SyncMailboxesEvent
	| SyncMessagesEvent
	| SyncMessageBodyEvent
	| MailboxManagementEvent
	| MessageManagementEvent
	| AppendSentMessageEvent
	| PlacementMovePushEvent
	| FlagPushEvent;
