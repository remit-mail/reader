import { randomUUID } from "node:crypto";
import type { SearchIndexMessage } from "@remit/search-service";

/**
 * The SQS search-index message the shared `remit-search-index-worker` consumer
 * expects. `accountId` is required by the schema but a relay from the outbox has
 * none to attach — the outbox row carries a bare message id. The consumer's
 * data ports re-derive the real accountId from the message's mailbox instead of
 * trusting this placeholder (see remit-search-index-worker/src/data-ports.ts).
 */
export const ACCOUNT_PLACEHOLDER = "outbox-relay";

export const toSearchIndexMessage = (
	messageId: string,
	force: boolean,
): SearchIndexMessage => ({
	eventName: "INSERT",
	entity: "Message",
	eventID: randomUUID(),
	eventTimestamp: Date.now(),
	accountId: ACCOUNT_PLACEHOLDER,
	keys: { pk: messageId, sk: "" },
	messageId,
	...(force ? { force: true } : {}),
});

export const toSearchIndexRemoveMessage = (
	messageId: string,
): SearchIndexMessage => ({
	eventName: "REMOVE",
	entity: "Message",
	eventID: randomUUID(),
	eventTimestamp: Date.now(),
	accountId: ACCOUNT_PLACEHOLDER,
	keys: { pk: messageId, sk: "" },
	messageId,
});
