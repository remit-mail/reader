import type { RemitClient } from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import { sweepAbandonedOutboxAttachments } from "@remit/storage-service";
/**
 * Collect attachment bytes the database does not know about. Both scheduler
 * entry points build it the same way, so the hosted tick and the self-host loop
 * collect identically — this is the only defence on the hosted side, where the
 * browser PUTs straight to block storage and nothing consults the database on
 * the way in.
 */
export const buildAttachmentSweep =
	(
		client: Pick<RemitClient, "storage" | "outboxAttachment">,
		log: Logger,
	): ((account: AccountItem) => Promise<void>) =>
	async (account) => {
		const { deleted, skipped } = await sweepAbandonedOutboxAttachments(
			{
				storage: client.storage,
				// Reaps the draft's lapsed reservations first, so a row that has
				// stopped holding room stops vouching for its bytes too and the
				// object is collected on this same pass.
				listKnownAttachmentIds: (accountConfigId, outboxMessageId) =>
					client.outboxAttachment.reapAndListLive(
						accountConfigId,
						outboxMessageId,
					),
				onSkipped: (outboxMessageId, error) => {
					log.error(
						{ outboxMessageId, error },
						"Left a draft's attachment objects alone: its rows could not be read",
					);
				},
			},
			account.accountConfigId,
			account.accountId,
		);

		if (deleted > 0 || skipped > 0) {
			log.warn(
				{ accountId: account.accountId, deleted, skipped },
				"Outbox attachment sweep",
			);
		}
	};
