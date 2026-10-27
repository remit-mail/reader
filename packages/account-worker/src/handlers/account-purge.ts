import type { GroupedQueueProducer } from "@remit/data-ports";
import type { Logger } from "@remit/logger";
import type { CascadeServices } from "../cascade.js";
import type {
	AccountDataPurgeEvent,
	AccountDataPurgeFinalizeEvent,
	AccountDataPurgeSubtreeItem,
} from "../events.js";

export interface ProcessPurgeFanoutDeps {
	queue: GroupedQueueProducer<AccountDataPurgeFinalizeEvent>;
	services: CascadeServices;
}

/**
 * Message subtrees carried per FIFO finalize message. Each item is two ids
 * (~70 bytes of JSON), so 100 stays far under the 256 KB SQS limit, and the
 * worker's per-item `describe()` + batched delete for 100 subtrees fits well
 * inside its timeout.
 */
const SUBTREE_BATCH_SIZE = 100;

/**
 * Enqueue the destructive purge work onto the FIFO finalize queue, single
 * message group per account so the worker processes everything strictly in
 * order: every `subtrees` batch first, then exactly one `container` leftover
 * last. The FIFO ordering is the barrier — the container delete (mailboxes,
 * S3, CloudFront) cannot run until all subtree deletes have. The queue's
 * content-based deduplication makes a fanout replay idempotent within the dedup
 * window; beyond it, the worker's deletes are no-ops on already-gone rows.
 */
const enqueuePurgeFinalize = async (
	queue: GroupedQueueProducer<AccountDataPurgeFinalizeEvent>,
	accountId: string,
	accountConfigId: string,
	items: AccountDataPurgeSubtreeItem[],
): Promise<void> => {
	const send = (event: AccountDataPurgeFinalizeEvent): Promise<void> =>
		queue.send({ body: event, groupId: accountConfigId });

	for (let i = 0; i < items.length; i += SUBTREE_BATCH_SIZE) {
		await send({
			type: "FinalizeAccountDataPurge",
			kind: "subtrees",
			accountId,
			accountConfigId,
			items: items.slice(i, i + SUBTREE_BATCH_SIZE),
		});
	}

	await send({
		type: "FinalizeAccountDataPurge",
		kind: "container",
		accountId,
		accountConfigId,
	});
};

/**
 * Fanout step of the per-account purge. Reads the account's ThreadMessage
 * manifest (`pk = accountConfigId`, scoped to this account's mailbox set) —
 * since the threading-visibility fix every persisted Message has exactly one
 * manifest row, so the partition is a complete, describe-free index of the
 * account's messages. Hands the destructive DDB+S3+CloudFront work to the
 * finalize worker as a stream of FIFO messages (subtree batches + one container
 * leftover, single message group). No self-loop, no recursion: the producer
 * enqueues all the work and the worker only ever consumes (#1069).
 *
 * Runs in the fanout worker. Scoped entirely to `accountId`; the AccountConfig,
 * its sibling accounts, the tenant-shared Address rows, and the soft-deleted
 * account row are untouched.
 *
 * Replay-safe: the manifest read is read-only and the finalize enqueues are
 * idempotent. A redelivery after the account's rows are gone reads
 * an empty manifest and enqueues only a container leftover that no-ops.
 */
export const processAccountDataPurge = async (
	event: AccountDataPurgeEvent,
	log: Logger,
	deps: ProcessPurgeFanoutDeps,
): Promise<void> => {
	const { accountId, accountConfigId } = event;
	const { services } = deps;

	let mailboxIds: Set<string>;
	try {
		const account = await services.accountService.describe(accountId);
		mailboxIds = new Set(account.mailbox.map((m) => m.mailboxId));
	} catch (error) {
		if ((error as { name?: string })?.name === "NotFoundError") {
			log.info(
				{ accountConfigId, accountId },
				"Account purge fanout: account already gone — no-op",
			);
			return;
		}
		throw error;
	}

	const manifest =
		await services.threadMessageService.listAllByAccount(accountConfigId);
	const items: AccountDataPurgeSubtreeItem[] = manifest
		.filter((tm) => mailboxIds.has(tm.mailboxId))
		.map((tm) => ({
			threadMessageId: tm.threadMessageId,
			messageId: tm.messageId,
		}));

	await enqueuePurgeFinalize(deps.queue, accountId, accountConfigId, items);
	log.info(
		{
			accountConfigId,
			accountId,
			subtreeCount: items.length,
			batchCount: Math.ceil(items.length / SUBTREE_BATCH_SIZE),
		},
		"Enqueued per-account purge subtree batches + container leftover",
	);
};
