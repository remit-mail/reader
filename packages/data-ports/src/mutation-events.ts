export const MUTATION_EVENT_SCHEMA_VERSION = 2;

export const PATHLESS_MUTATION_EVENT_SCHEMA_VERSION = 3;

interface MutationEventBase {
	accountId: string;
	eventId: string;
	timestamp: number;
	schemaVersion: typeof PATHLESS_MUTATION_EVENT_SCHEMA_VERSION;
}

export interface MessageDeleteEventV3 extends MutationEventBase {
	type: "MESSAGE_DELETE";
	messageId: string;
	mailboxId: string;
	uid: number;
	operation: "move_to_trash" | "permanent_delete";
	destinationMailboxId?: string;
}

export interface MessageMoveEventV3 extends MutationEventBase {
	type: "MESSAGE_MOVE";
	messageId: string;
	sourceMailboxId: string;
	destinationMailboxId: string;
	uid: number;
}

export interface EmptyTrashEventV3 extends MutationEventBase {
	type: "EMPTY_TRASH";
	trashMailboxId: string;
	/**
	 * The Trash folder's UIDVALIDITY at the moment the user consented. The
	 * handler compares it against what the SELECT serves: a path reused by a
	 * different folder (rename plus recreate) answers with a different value,
	 * and this is the only comparison the mutating connection cannot race.
	 */
	trashUidValidity: number;
}

export interface MessageCopyEventV3 extends MutationEventBase {
	type: "MESSAGE_COPY";
	sourceMessageId: string;
	newMessageId: string;
	sourceMailboxId: string;
	destinationMailboxId: string;
	uid: number;
}

/**
 * Queue payloads are `JSON.parse`d and cast with no validation, so the declared
 * type is a promise the queue cannot keep. A handler that cannot vouch for an
 * event's shape abandons it — treating a missing field as "skip the check"
 * makes the unverified expunge the default for every event we cannot vouch for,
 * including any future producer that forgets the field.
 */
export const isAcceptedSchemaVersion = (value: unknown): boolean =>
	value === MUTATION_EVENT_SCHEMA_VERSION ||
	value === PATHLESS_MUTATION_EVENT_SCHEMA_VERSION;
