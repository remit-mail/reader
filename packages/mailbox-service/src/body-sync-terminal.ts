import type { IMessageRepository } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import type { BodySyncLogger } from "./body-sync.js";
import {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "./stale-message-reconcile.js";
import type { IImapConnection } from "./types.js";

/**
 * Body-part sentinel path a permanently-broken message's failure context is
 * written under, mirroring the `.materialized` deferred-parts sentinel in
 * `body-sync.ts`. Using the existing per-message body-part storage (instead
 * of a new Message-row column) means no schema change: the read path checks
 * for it with the same `bodyPartExists` HEAD it already issues.
 */
const BODY_SYNC_FAILED_MARKER_PATH = ".sync-failed";

export interface ResolveExhaustedBodySyncDeps
	extends StaleMessageReconcileDeps {
	messageService: Pick<IMessageRepository, "get" | "delete">;
	storageService: Pick<StorageService, "storeBodyPart" | "bodyPartExists">;
	log: BodySyncLogger;
}

export interface ResolveExhaustedBodySyncInput {
	accountId: string;
	accountConfigId: string;
	mailboxId: string;
	mailboxPath: string;
	failedMessageIds: string[];
	getConnection: () => Promise<IImapConnection>;
}

export interface ResolveExhaustedBodySyncResult {
	/** Outcome 1 (EXPECTED): message gone upstream, row deleted. */
	reconciledMessageIds: string[];
	/** Outcome 2 (BROKEN): message exists but is unfetchable/unparseable. */
	brokenMessageIds: string[];
}

/**
 * Whether a message's body-sync has already been marked permanently failed
 * (outcome 2 of {@link resolveExhaustedBodySyncFailures}). The read path
 * calls this before attempting or re-arming any fetch so a client that opens
 * a broken message gets the explicit unrecoverable error immediately instead
 * of looping through another 202 or another IMAP round-trip.
 */
export const isMessageBodySyncBroken = (
	storageService: Pick<StorageService, "bodyPartExists">,
	accountConfigId: string,
	accountId: string,
	messageId: string,
): Promise<boolean> =>
	storageService.bodyPartExists(
		accountConfigId,
		accountId,
		messageId,
		BODY_SYNC_FAILED_MARKER_PATH,
	);

const markMessageBodySyncFailed = async (
	storageService: Pick<StorageService, "storeBodyPart">,
	accountConfigId: string,
	accountId: string,
	messageId: string,
	context: Record<string, unknown>,
): Promise<void> => {
	await storageService.storeBodyPart({
		accountConfigId,
		accountId,
		messageId,
		partPath: BODY_SYNC_FAILED_MARKER_PATH,
		content: Buffer.from(JSON.stringify({ ...context, failedAt: Date.now() })),
		contentType: "application/json",
	});
};

/**
 * Resolve every SYNC_MESSAGE_BODY failure that has exhausted the body
 * queue's redelivery budget (see `BODY_SYNC_MAX_ATTEMPTS` in
 * `sync-message-body.ts`) into exactly one of the two terminal outcomes
 * issue #1270 / epic #1281 invariant 3 require. There is no third, softer
 * outcome — every failed id lands in one of the two result lists.
 *
 * 1. EXPECTED — the message no longer exists on IMAP (expunged, or a
 *    UIDVALIDITY change moved it, #1272). The stale row is deleted via
 *    {@link reconcileStaleMessage} so the existing missing-row 404 path
 *    takes over. Callers should emit a metric only — this is routine, not an
 *    incident.
 * 2. BROKEN — the message still exists on IMAP but its body could not be
 *    fetched or parsed. The failure is persisted as a body-part sentinel
 *    (survives across invocations and warm/cold starts) and logged with an
 *    `alert`-shaped entry so an operator alarm can key off it. Callers
 *    should treat this as loud: the message is unrecoverable until an
 *    operator investigates.
 *
 * Neither outcome re-enqueues: both are terminal, so the caller acks the SQS
 * message either way — retrying a stale or broken message can never succeed.
 */
export const resolveExhaustedBodySyncFailures = async (
	deps: ResolveExhaustedBodySyncDeps,
	input: ResolveExhaustedBodySyncInput,
): Promise<ResolveExhaustedBodySyncResult> => {
	const {
		accountId,
		accountConfigId,
		mailboxId,
		mailboxPath,
		failedMessageIds,
		getConnection,
	} = input;

	const reconciledMessageIds: string[] = [];
	const brokenMessageIds: string[] = [];

	if (failedMessageIds.length === 0) {
		return { reconciledMessageIds, brokenMessageIds };
	}

	const connection = await getConnection();
	await connection.openBox(mailboxPath);

	for (const messageId of failedMessageIds) {
		const message = await deps.messageService.get(messageId);
		const found = await connection.fetchMessages([message.uid]);

		if (found.length === 0) {
			const { threadMessagesDeleted } = await reconcileStaleMessage(
				deps,
				accountConfigId,
				messageId,
			);
			deps.log.info(
				{
					metric: "body_sync_stale_row_reconciled",
					accountId,
					accountConfigId,
					mailboxId,
					messageId,
					uid: message.uid,
					threadMessagesDeleted,
				},
				"Message no longer exists on IMAP after retry exhaustion; stale row reconciled",
			);
			reconciledMessageIds.push(messageId);
			continue;
		}

		await markMessageBodySyncFailed(
			deps.storageService,
			accountConfigId,
			accountId,
			messageId,
			{ accountId, accountConfigId, mailboxId, messageId, uid: message.uid },
		);
		deps.log.error?.(
			{
				alert: "body_sync_message_broken",
				accountId,
				accountConfigId,
				mailboxId,
				messageId,
				uid: message.uid,
			},
			"Message body could not be fetched/parsed after retry exhaustion; message exists on IMAP but is unrecoverable",
		);
		brokenMessageIds.push(messageId);
	}

	return { reconciledMessageIds, brokenMessageIds };
};
