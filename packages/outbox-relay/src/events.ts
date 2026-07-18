// The transactional-outbox event vocabulary, shared by every search-index
// producer regardless of backend (RFC 036 D2). The Postgres relay
// (remit-pg-index-worker) and the SQLite drain (remit-search-index-worker) read
// the same event strings off the same-named outbox columns, so the drain logic
// lives here once instead of in each worker.

/** Body-synced: the parsed body just landed, so the message has new content. */
export const BODY_SYNCED_EVENT = "message.body_synced";
/**
 * Moved: the message settled in a new mailbox. Its body is unchanged, so the
 * worker must re-index it with `force` to refresh the stored mailbox metadata —
 * an unchanged content hash would otherwise be skipped.
 */
export const MESSAGE_MOVED_EVENT = "message.moved";
/**
 * Removed: the message's rows were deleted (account purge / cascade). The worker
 * relays a search-index REMOVE so the vectors are dropped.
 */
export const MESSAGE_REMOVED_EVENT = "message.removed";

export const DRAIN_EVENTS = [
	BODY_SYNCED_EVENT,
	MESSAGE_MOVED_EVENT,
	MESSAGE_REMOVED_EVENT,
];

export interface PendingIndexEvent {
	messageId: string;
	event: string;
	/** A move re-index must force a metadata refresh over an unchanged body. */
	force: boolean;
	/** A removal drops the message's vectors instead of indexing them. */
	remove: boolean;
}

/** A move event forces a re-index; a body-synced event does not. */
export const isForceEvent = (event: string): boolean =>
	event === MESSAGE_MOVED_EVENT;

/** A removal event drops vectors instead of indexing. */
export const isRemoveEvent = (event: string): boolean =>
	event === MESSAGE_REMOVED_EVENT;

/**
 * The Postgres outbox NOTIFY trigger sends `<event>:<messageId>`. A move event
 * forces a metadata refresh; a body-synced event does not. A payload with no
 * known event prefix is treated as a bare message id (an id may contain a
 * colon) with no force — keeps an un-migrated trigger that still emits bare ids
 * working. SQLite has no NOTIFY and reads rows directly, so only the Postgres
 * relay uses this.
 */
export const parseNotifyPayload = (
	payload: string,
): { messageId: string; force: boolean; remove: boolean } => {
	const sep = payload.indexOf(":");
	if (sep !== -1) {
		const event = payload.slice(0, sep);
		if (
			event === BODY_SYNCED_EVENT ||
			event === MESSAGE_MOVED_EVENT ||
			event === MESSAGE_REMOVED_EVENT
		) {
			return {
				messageId: payload.slice(sep + 1),
				force: isForceEvent(event),
				remove: isRemoveEvent(event),
			};
		}
	}
	return { messageId: payload, force: false, remove: false };
};
