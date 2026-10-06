import { randomUUID } from "node:crypto";
import type { IMailboxLockRepository } from "@remit/data-ports";
import { emitEvent } from "./emit.js";
import type { SyncMessagesEvent } from "./events.js";

export const SYNC_MESSAGES_PENDING = "SYNC_MESSAGES_PENDING";

type PendingMarkers = Pick<
	IMailboxLockRepository,
	"tryAcquireLock" | "releaseLock"
>;

type SyncMessagesInput = Omit<SyncMessagesEvent, "eventId" | "timestamp">;

type EmitWithId = (
	event: SyncMessagesInput,
	options: { eventId: string },
) => Promise<unknown>;

export type SyncMessagesOutcome = { enqueued: boolean };

export const emitSyncMessagesOnce = async (
	markers: PendingMarkers,
	event: SyncMessagesInput,
	emit: EmitWithId = emitEvent,
): Promise<SyncMessagesOutcome> => {
	const eventId = randomUUID();
	const acquired = await markers.tryAcquireLock(
		event.mailboxId,
		SYNC_MESSAGES_PENDING,
		event.accountId,
		eventId,
	);
	if (!acquired) return { enqueued: false };

	await emit(event, { eventId }).catch(async (error: unknown) => {
		await markers.releaseLock(
			event.accountId,
			event.mailboxId,
			SYNC_MESSAGES_PENDING,
			eventId,
		);
		throw error;
	});
	return { enqueued: true };
};

export const clearPendingSyncMessages = (
	markers: Pick<IMailboxLockRepository, "releaseLock">,
	event: Pick<SyncMessagesEvent, "accountId" | "mailboxId" | "eventId">,
): Promise<void> =>
	markers.releaseLock(
		event.accountId,
		event.mailboxId,
		SYNC_MESSAGES_PENDING,
		event.eventId,
	);
