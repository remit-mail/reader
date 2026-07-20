import type { QuarantineItem, QuarantineUpsertInput } from "../types.js";

export interface IQuarantineRepository {
	/**
	 * Every quarantined message for one user, newest first. Unpaginated: the
	 * list is small by design, and it is read whole both by the settings
	 * surface and by a sync round that keeps it in memory.
	 */
	listByAccountConfigId(accountConfigId: string): Promise<QuarantineItem[]>;

	/**
	 * Record a message the sync path could not apply.
	 *
	 * Idempotent on the message's identity: the row is keyed by an id derived
	 * from (accountId, mailboxId, uidValidity, uid), so quarantining the same
	 * message twice rewrites one row instead of accumulating. The derivation
	 * happens here rather than at the call site — see `QuarantineUpsertInput`.
	 *
	 * A cursor may only move past a message once this has resolved.
	 */
	upsert(input: QuarantineUpsertInput): Promise<void>;
}
