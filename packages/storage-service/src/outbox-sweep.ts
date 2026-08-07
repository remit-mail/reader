import { liveEntries } from "./outbox-ledger.js";
import type { StorageService } from "./storage.js";

/**
 * Collect attachment bytes that no ledger vouches for.
 *
 * There is one way for those to exist, and it is not reachable any other way:
 * on a deployment where the browser PUTs straight to block storage, an upload
 * URL stays valid for its full window even after the draft it was minted for is
 * discarded. Nothing consults the ledger on that path — that is the point of
 * it — so the bytes land under a prefix whose row is gone. The self-hosted
 * receiver refuses the same request outright; this is the other half.
 *
 * The rule is simple enough to be obviously right: an object under a draft's
 * attachment prefix is kept only if that draft's ledger has a live entry naming
 * it. Everything else is garbage, whether the draft was discarded, the
 * reservation lapsed, or the upload was never confirmed.
 */
export interface OutboxSweepResult {
	inspected: number;
	deleted: number;
}

export const sweepAbandonedOutboxAttachments = async (
	storage: StorageService,
	accountConfigId: string,
	accountId: string,
	nowSeconds: number,
): Promise<OutboxSweepResult> => {
	let inspected = 0;
	let deleted = 0;

	const outboxMessageIds = await storage.listOutboxDraftsWithAttachments(
		accountConfigId,
		accountId,
	);

	for (const outboxMessageId of outboxMessageIds) {
		const objects = await storage.listOutboxAttachments(
			accountConfigId,
			accountId,
			outboxMessageId,
			1000,
		);
		if (objects.length === 0) continue;
		inspected += objects.length;

		const { ledger } = await storage.readOutboxLedger(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		const vouched = new Set(
			liveEntries(ledger, nowSeconds).map((entry) => entry.outboxAttachmentId),
		);

		for (const object of objects) {
			if (vouched.has(object.outboxAttachmentId)) continue;
			await storage.deleteOutboxAttachment(
				accountConfigId,
				accountId,
				outboxMessageId,
				object.outboxAttachmentId,
			);
			deleted += 1;
		}
	}

	return { inspected, deleted };
};
