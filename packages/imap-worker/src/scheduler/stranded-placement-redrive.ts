import type { RemitClient } from "@remit/backend/client";
import type { AccountItem, MessageItem } from "@remit/data-ports";
import { trashMailboxAt } from "@remit/data-ports/folder-role";
import {
	deriveCopyMessageId,
	deriveMessageId,
	isValidMessageId,
} from "@remit/data-ports/id";
import { PATHLESS_MUTATION_EVENT_SCHEMA_VERSION } from "@remit/data-ports/mutation-events";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger";
import { isCursorRebuildNeeded } from "@remit/mailbox-service";
import type {
	MessageCopyEventV3,
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
	| Unstamped<MessageMoveEventV3>
	| Unstamped<MessageCopyEventV3>;

export interface StrandedPlacementRedriveDeps {
	client: Pick<
		RemitClient,
		| "mailbox"
		| "mailboxSpecialUse"
		| "message"
		| "placementMove"
		| "threadMessage"
	>;
	emit: (event: StrandedPlacementEvent) => Promise<void>;
	log: Logger;
}

const isStrandedCopy = (row: MessageItem): boolean =>
	row.status === MessageStatus.moving &&
	row.uid === 0 &&
	typeof row.originalUid !== "number";

type CopyRedrive =
	| { kind: "redrive"; event: Unstamped<MessageCopyEventV3> }
	| { kind: "unresolvable"; reason: string }
	| { kind: "wait" };

/**
 * The message a uid-0 copy was made from: its id derives from the Message-ID
 * the copy's listing row carries, and the copy's own id derives from it.
 */
const copyRedriveFor = async (
	client: StrandedPlacementRedriveDeps["client"],
	account: AccountItem,
	copy: MessageItem,
): Promise<CopyRedrive> => {
	const listing = await client.threadMessage.findByMessageId(
		account.accountConfigId,
		copy.messageId,
	);
	if (!listing) return { kind: "unresolvable", reason: "listing row missing" };
	const header = listing.messageIdHeader;
	if (!header || !isValidMessageId(header)) {
		return { kind: "unresolvable", reason: "listing row has no Message-ID" };
	}
	const sourceId = deriveMessageId(account.accountId, header);
	if (deriveCopyMessageId(sourceId, copy.mailboxId) !== copy.messageId) {
		return {
			kind: "unresolvable",
			reason: "copy was not made from the message its Message-ID names",
		};
	}
	const [source] = await client.message.get([sourceId]);
	if (!source) return { kind: "unresolvable", reason: "source row missing" };
	if (source.status === MessageStatus.deleted) {
		return { kind: "unresolvable", reason: "source row deleted" };
	}
	if (source.status !== MessageStatus.active) return { kind: "wait" };
	return {
		kind: "redrive",
		event: {
			type: "MESSAGE_COPY",
			schemaVersion: PATHLESS_MUTATION_EVENT_SCHEMA_VERSION,
			accountId: account.accountId,
			sourceMessageId: source.messageId,
			newMessageId: copy.messageId,
			sourceMailboxId: source.mailboxId,
			destinationMailboxId: copy.mailboxId,
			uid: source.uid,
		},
	};
};

/** A copy with no source to copy from has nothing to bind and nothing to hide. */
const removeUnresolvableCopy = async (
	deps: StrandedPlacementRedriveDeps,
	account: AccountItem,
	row: MessageItem,
	reason: string,
	now: number,
): Promise<boolean> => {
	const removed =
		(
			await deps.client.message.deleteIfPlacement(row.messageId, {
				status: MessageStatus.moving,
				mailboxId: row.mailboxId,
				uid: 0,
			})
		).length > 0;
	if (!removed) return false;
	deps.log.error(
		{
			alert: "stranded_copy_unresolvable",
			accountId: account.accountId,
			messageId: row.messageId,
			mailboxId: row.mailboxId,
			reason,
			untouchedForMs: now - row.updatedAt,
		},
		"A copy stranded at uid 0 has no source to copy from; the copy row was removed",
	);
	return true;
};

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
		const copy = isStrandedCopy(row)
			? await copyRedriveFor(client, account, row)
			: undefined;
		if (copy?.kind === "wait") continue;
		if (copy?.kind === "unresolvable") {
			if (await removeUnresolvableCopy(deps, account, row, copy.reason, now)) {
				redriven += 1;
			}
			continue;
		}
		const event =
			copy?.kind === "redrive"
				? copy.event
				: await eventFor(client, account, row, trashMailboxId);
		if (!event) continue;

		// A copy's earlier COPY may have landed with its answer lost, so the
		// re-drive marks it `failed`: the copy handler then asks the destination
		// before it copies again.
		const claimed = await client.message.transitionPlacement(
			row.messageId,
			{ status: row.status, mailboxId: row.mailboxId, uid: row.uid },
			{
				syncStatus: copy ? MessageSyncStatus.failed : MessageSyncStatus.pending,
			},
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
