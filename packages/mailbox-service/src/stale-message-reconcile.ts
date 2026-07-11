import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";

export interface StaleMessageReconcileDeps {
	messageService: Pick<IMessageRepository, "delete">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "deleteMany"
	>;
}

export interface StaleMessageReconcileResult {
	threadMessagesDeleted: number;
}

/**
 * Delete a Message row (and every ThreadMessage copy that points at it) once
 * the caller has confirmed the message no longer exists on the IMAP server.
 *
 * A row outliving an upstream expunge (or a UIDVALIDITY change — #1272) is
 * the EXPECTED terminal outcome for a body that can never be fetched (issue
 * #1270 / epic #1281 invariant 3): expunges are routine, so cleaning up here
 * is normal operation, not an incident. Deleting the row makes the existing
 * missing-row 404 path (`MessageService.get` / `describe`) authoritative
 * again — nothing renders the row, nothing re-arms a sync for it.
 *
 * Exported standalone, not inlined in the body-sync retry path, so #1272's
 * UIDVALIDITY cursor rebuild can call the same reconciliation when it finds
 * rows whose UIDs no longer resolve after a cursor rebuild.
 */
export const reconcileStaleMessage = async (
	deps: StaleMessageReconcileDeps,
	accountConfigId: string,
	messageId: string,
): Promise<StaleMessageReconcileResult> => {
	const threadMessages = await deps.threadMessageService.findAllByMessageId(
		accountConfigId,
		messageId,
	);

	if (threadMessages.length > 0) {
		await deps.threadMessageService.deleteMany(
			threadMessages.map((row) => ({
				accountConfigId: row.accountConfigId,
				threadMessageId: row.threadMessageId,
			})),
		);
	}

	await deps.messageService.delete(messageId);

	return { threadMessagesDeleted: threadMessages.length };
};
