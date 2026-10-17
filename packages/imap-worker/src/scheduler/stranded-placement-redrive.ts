import type { RemitClient } from "@remit/backend/client";
import type { AccountItem, MessageItem } from "@remit/data-ports";
import { trashMailboxAt } from "@remit/data-ports/folder-role";
import { PATHLESS_MUTATION_EVENT_SCHEMA_VERSION } from "@remit/data-ports/mutation-events";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { isCursorRebuildNeeded } from "@remit/mailbox-service";
import type {
	MessageDeleteEventV3,
	MessageMoveEventV3,
	PlacementMovePushEvent,
} from "../events.js";

/** Well past three attempts on a 60 s visibility timeout. */
export const STRANDED_PLACEMENT_AFTER_MILLIS = 60 * 60 * 1000;

type Unstamped<T> = Omit<T, "eventId" | "timestamp">;

export type StrandedPlacementEvent =
	| Unstamped<PlacementMovePushEvent>
	| Unstamped<MessageDeleteEventV3>
	| Unstamped<MessageMoveEventV3>;

export interface StrandedPlacementRedriveDeps {
	client: Pick<
		RemitClient,
		"mailbox" | "mailboxSpecialUse" | "message" | "placementMove"
	>;
	emit: (event: StrandedPlacementEvent) => Promise<void>;
	log: Logger;
}

const eventFor = async (
	client: StrandedPlacementRedriveDeps["client"],
	account: AccountItem,
	row: MessageItem,
	trashMailboxId: string | undefined,
): Promise<StrandedPlacementEvent | undefined> => {
	const { accountId, accountConfigId } = account;
	const { messageId } = row;

	if (row.status === MessageStatus.deleting) {
		return {
			type: "MESSAGE_DELETE",
			schemaVersion: PATHLESS_MUTATION_EVENT_SCHEMA_VERSION,
			accountId,
			messageId,
			mailboxId: row.mailboxId,
			uid: row.uid,
			operation: "permanent_delete",
		};
	}
	if (
		typeof row.originalMailboxId !== "string" ||
		typeof row.originalUid !== "number"
	) {
		return undefined;
	}

	const marker = await client.placementMove.find(messageId);
	if (marker && marker.destinationMailboxId === row.mailboxId) {
		return {
			type: "PLACEMENT_MOVE_PUSH",
			accountId,
			accountConfigId,
			messageId,
		};
	}
	if (row.mailboxId === trashMailboxId) {
		return {
			type: "MESSAGE_DELETE",
			schemaVersion: PATHLESS_MUTATION_EVENT_SCHEMA_VERSION,
			accountId,
			messageId,
			mailboxId: row.originalMailboxId,
			uid: row.originalUid,
			operation: "move_to_trash",
			destinationMailboxId: row.mailboxId,
		};
	}
	return {
		type: "MESSAGE_MOVE",
		schemaVersion: PATHLESS_MUTATION_EVENT_SCHEMA_VERSION,
		accountId,
		messageId,
		sourceMailboxId: row.originalMailboxId,
		destinationMailboxId: row.mailboxId,
		uid: row.originalUid,
	};
};

/** The claim restarts the row's clock; a folder awaiting a cursor rebuild waits until it is normal. */
export const redriveStrandedPlacements = async (
	deps: StrandedPlacementRedriveDeps,
	account: AccountItem,
	now: number,
): Promise<number> => {
	const { client, emit, log } = deps;
	const { accountId } = account;

	const mailboxes = await client.mailbox.listAllByAccount(accountId);
	const paused = new Set(
		mailboxes
			.filter((mailbox) => isCursorRebuildNeeded(mailbox.cursorState))
			.map((mailbox) => mailbox.mailboxId),
	);
	const stranded = (
		await client.message.listStrandedPlacements(
			mailboxes.map((mailbox) => mailbox.mailboxId),
			now - STRANDED_PLACEMENT_AFTER_MILLIS,
		)
	).filter(
		(row) =>
			!paused.has(row.mailboxId) &&
			!(row.originalMailboxId && paused.has(row.originalMailboxId)),
	);
	if (stranded.length === 0) return 0;

	const trash = trashMailboxAt(
		await client.mailboxSpecialUse.resolveTrashRole(accountId),
		"resolved",
	);
	const trashMailboxId = trash.allowed ? trash.mailbox.mailboxId : undefined;

	let redriven = 0;
	for (const row of stranded) {
		const event = await eventFor(client, account, row, trashMailboxId);
		if (!event) continue;

		const claimed = await client.message.transitionPlacement(
			row.messageId,
			{ status: row.status, mailboxId: row.mailboxId, uid: row.uid },
			{ syncStatus: MessageSyncStatus.pending },
		);
		if (!claimed) continue;

		await emit(event);
		redriven += 1;
		log.warn(
			{
				metric: "stranded_placement_redriven",
				accountId,
				messageId: row.messageId,
				event: event.type,
				syncStatus: row.syncStatus,
				untouchedForMs: now - row.updatedAt,
			},
			"A move or delete had no event left to settle it; re-driven",
		);
	}
	return redriven;
};
