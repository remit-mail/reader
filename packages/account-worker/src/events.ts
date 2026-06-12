export type AccountDeleteEvent = {
	type: "AccountDelete";
	accountConfigId: string;
};

/**
 * Per-account hard-delete. Purges ONE mail account's data (mailboxes,
 * messages, body parts, thread messages, S3 objects, search vectors) while
 * keeping the AccountConfig/tenant and any sibling accounts intact. Emitted
 * by the API on `deleteAccount`; consumed by the fanout worker.
 */
export type AccountDataPurgeEvent = {
	type: "AccountDataPurge";
	accountId: string;
	accountConfigId: string;
};

export type AccountFanoutEvent = AccountDeleteEvent | AccountDataPurgeEvent;

export type AccountDeleteFinalizeEvent = {
	type: "FinalizeAccountDelete";
	accountConfigId: string;
};

/**
 * Destructive phase of the per-account purge: DDB cascade delete, S3 prefix
 * cleanup, and CloudFront invalidation for ONE account. Emitted by the fanout
 * worker (after it enqueues the search-index/vector deletes) and consumed by
 * the finalize worker, which already holds the S3-delete, CloudFront, and DDB
 * batch-write grants. Reuses the existing finalize queue + worker — no new
 * infrastructure or IAM.
 */
export type AccountDataPurgeFinalizeEvent = {
	type: "FinalizeAccountDataPurge";
	accountId: string;
	accountConfigId: string;
};

export type AccountFinalizeEvent =
	| AccountDeleteFinalizeEvent
	| AccountDataPurgeFinalizeEvent;
