/**
 * The contract version the mail-destroying queue events are minted under.
 *
 * It lives here because the producer (`MessageMoveService`) and the consumer
 * (the imap-worker's handlers) sit in packages that cannot import each other,
 * and a version the two sides disagree about is worse than no version at all.
 * Bump it whenever a handler starts relying on a field an older producer never
 * set.
 */
export const MUTATION_EVENT_SCHEMA_VERSION = 2;

/**
 * Queue payloads are `JSON.parse`d and cast with no validation, so the declared
 * type is a promise the queue cannot keep. A handler that cannot vouch for an
 * event's shape abandons it — treating a missing field as "skip the check"
 * makes the unverified expunge the default for every event we cannot vouch for,
 * including any future producer that forgets the field.
 */
export const isCurrentSchemaVersion = (value: unknown): boolean =>
	value === MUTATION_EVENT_SCHEMA_VERSION;
