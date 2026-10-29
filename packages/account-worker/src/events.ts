export type {
	AccountDataPurgeEvent,
	AccountDeleteEvent,
	AccountExportEvent,
	AccountFanoutEvent,
	OrganizeJobEvent,
	SenderCategoryBackApplyEvent,
} from "@remit/data-ports";

export type AccountDeleteFinalizeEvent = {
	type: "FinalizeAccountDelete";
	accountConfigId: string;
};

/** One message subtree to delete: its manifest row plus the Message it indexes. */
export type AccountDataPurgeSubtreeItem = {
	threadMessageId: string;
	messageId: string;
};

/**
 * Destructive phase of the per-account purge. The fanout worker reads the
 * account's ThreadMessage manifest and emits a stream of these onto a FIFO
 * queue, single message group per account: a series of `subtrees` batches
 * followed by exactly one `container` leftover. FIFO ordering guarantees the
 * container runs only after every subtree delete — no fan-in counter and no
 * self-re-enqueue. The finalize worker consumes them and already holds the
 * S3-delete, CloudFront, and DDB batch-write grants.
 *
 * - `subtrees`: delete each `{ threadMessageId, messageId }` subtree (the
 *   Message, its child entities, and the manifest row). Idempotent.
 * - `container`: the last message — delete the account-keyed container rows
 *   (mailboxes, outbox, locks), the S3 prefix, and the CloudFront cache. The
 *   tenant-shared Address is never deleted.
 */
export type AccountDataPurgeFinalizeEvent =
	| {
			type: "FinalizeAccountDataPurge";
			kind: "subtrees";
			accountId: string;
			accountConfigId: string;
			items: AccountDataPurgeSubtreeItem[];
	  }
	| {
			type: "FinalizeAccountDataPurge";
			kind: "container";
			accountId: string;
			accountConfigId: string;
	  };

export type AccountFinalizeEvent =
	| AccountDeleteFinalizeEvent
	| AccountDataPurgeFinalizeEvent;
