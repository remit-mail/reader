import type { StorageService } from "./storage.js";

/**
 * Collect attachment bytes the database does not know about.
 *
 * A presigned upload URL stays valid for its whole window, including after the
 * draft it was minted for is discarded, and on a deployment where the browser
 * PUTs straight to block storage there is nothing in that path to consult. So
 * an object can exist that no row names. That is the only case this exists for,
 * and the rule is the whole of it: an object survives if the database still has
 * an attachment row for it.
 *
 * Two orderings matter and both are deliberate. Objects are listed *before* the
 * rows are read, so an attachment reserved between the two reads is seen as a
 * row and not as an object, and is kept. And a draft whose row lookup fails is
 * skipped entirely — "I could not find out what is live" must never be acted on
 * as "nothing is live".
 */
export interface OutboxSweepResult {
	inspected: number;
	deleted: number;
	/** Drafts skipped because their attachment rows could not be read. */
	skipped: number;
}

export interface OutboxSweepDeps {
	storage: StorageService;
	/**
	 * The attachment ids the database holds for a draft. Throwing is the right
	 * way to say "unknown" — the sweep then leaves that draft alone.
	 */
	listKnownAttachmentIds: (
		accountConfigId: string,
		outboxMessageId: string,
	) => Promise<string[]>;
	onSkipped: (outboxMessageId: string, error: unknown) => void;
}

export const sweepAbandonedOutboxAttachments = async (
	deps: OutboxSweepDeps,
	accountConfigId: string,
	accountId: string,
): Promise<OutboxSweepResult> => {
	let inspected = 0;
	let deleted = 0;
	let skipped = 0;

	const outboxMessageIds = await deps.storage.listOutboxDraftsWithAttachments(
		accountConfigId,
		accountId,
	);

	for (const outboxMessageId of outboxMessageIds) {
		const objects = await deps.storage.listOutboxAttachments(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		if (objects.length === 0) continue;

		const known = await deps
			.listKnownAttachmentIds(accountConfigId, outboxMessageId)
			.then((ids) => new Set(ids))
			.catch((error: unknown) => {
				deps.onSkipped(outboxMessageId, error);
				return null;
			});
		if (known === null) {
			skipped += 1;
			continue;
		}

		inspected += objects.length;
		const abandoned = objects.filter(
			(object) => !known.has(object.outboxAttachmentId),
		);

		// A draft whose every object is abandoned is the common case — it was
		// discarded — and taking the prefix in one call beats one round trip per
		// object.
		if (abandoned.length === objects.length) {
			await deps.storage.deleteOutboxAttachments(
				accountConfigId,
				accountId,
				outboxMessageId,
			);
			deleted += abandoned.length;
			continue;
		}

		for (const object of abandoned) {
			await deps.storage.deleteOutboxAttachment(
				accountConfigId,
				accountId,
				outboxMessageId,
				object.outboxAttachmentId,
			);
			deleted += 1;
		}
	}

	return { inspected, deleted, skipped };
};
