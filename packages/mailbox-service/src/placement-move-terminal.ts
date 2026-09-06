import { MessageSyncStatus } from "@remit/domain-enums";
import { isMessageGoneFromOpenMailbox } from "./message-presence.js";
import type { PlacementMoveLogger } from "./placement-move.js";
import {
	type RestoreSourcePlacementDeps,
	restoreSourcePlacement,
} from "./restore-source-placement.js";
import {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "./stale-message-reconcile.js";
import type { IImapConnection } from "./types.js";

export interface ResolveExhaustedPlacementMoveDeps {
	messageService: StaleMessageReconcileDeps["messageService"] &
		RestoreSourcePlacementDeps["messageService"];
	threadMessageService: StaleMessageReconcileDeps["threadMessageService"] &
		RestoreSourcePlacementDeps["threadMessageService"];
	markerService: { delete(messageId: string): Promise<void> };
	log: PlacementMoveLogger;
}

export interface ResolveExhaustedPlacementMoveInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	uid: number;
	sourceMailboxId: string;
	sourceMailboxPath: string;
	getConnection: () => Promise<IImapConnection>;
}

export type PlacementMoveTerminalOutcome = "reconciled" | "broken";

export interface ResolveExhaustedPlacementMoveResult {
	outcome: PlacementMoveTerminalOutcome;
}

/**
 * Resolve a PLACEMENT_MOVE_PUSH failure that has exhausted the placement-move
 * queue's redelivery budget into exactly one of two terminal outcomes,
 * mirroring `resolveExhaustedBodySyncFailures` (#1270) for the same failure
 * taxonomy (epic #1281 invariant 3) — no third, softer outcome.
 *
 * 1. RECONCILED (expected) — the message no longer exists at its pending-move
 *    source on IMAP, confirmed by {@link isMessageGoneFromOpenMailbox} rather
 *    than by a FETCH coming back empty. Per invariant 2, an external delete
 *    supersedes the marker entirely: the marker is dropped and the stale
 *    Message/ThreadMessage rows are deleted via
 *    {@link reconcileStaleMessage}. This is also the
 *    outcome for the (rarer, functionally indistinguishable from here) case
 *    where a foreign client moved the message elsewhere — either way, our
 *    prediction no longer holds, and the marker cannot be honoured. Metric
 *    only, no alarm — routine.
 * 2. BROKEN — the message still exists at the source, but the move keeps
 *    failing. This indicates broken code or a broken account (issue #1271),
 *    not a transient blip. The row is put back on the source pair the server
 *    has just confirmed, exactly as the move and delete resolvers do, and the
 *    marker goes with it: an auto-file whose push gave up must not leave
 *    `moving` plus the destination folder plus the source's uid standing
 *    forever, because that pair refuses every later delete and move with a
 *    409, blocks the sighting repair, and nothing else clears it. The failure
 *    is an operator's to read, so it lives in the `alert`-shaped log entry and
 *    the alarm on it — not in a row the user's own mail is stuck behind.
 *    Never re-thrown (terminal — the caller acks either way, since retrying a
 *    stale or permanently-broken move can never succeed).
 *
 * An operator reading `placement_move_failed` should know one case where the
 * message is not actually at the source: a message another client expunged
 * mid-session can answer an empty FETCH while the server still lists its UID
 * in SEARCH, until it is allowed to send the untagged EXPUNGE. That message
 * lands in BROKEN, and BROKEN is terminal — the alert stands until someone
 * clears it, and the row goes back to a source the message may already have
 * left. The reverse mistake deletes live mail, so the cost is paid
 * deliberately: a stale alert over a row the next sync re-points is
 * recoverable, a deleted message is not.
 */
export const resolveExhaustedPlacementMoveFailure = async (
	deps: ResolveExhaustedPlacementMoveDeps,
	input: ResolveExhaustedPlacementMoveInput,
): Promise<ResolveExhaustedPlacementMoveResult> => {
	const {
		accountId,
		accountConfigId,
		messageId,
		uid,
		sourceMailboxId,
		sourceMailboxPath,
		getConnection,
	} = input;

	const connection = await getConnection();
	await connection.openBox(sourceMailboxPath);

	if (await isMessageGoneFromOpenMailbox(connection, uid)) {
		await deps.markerService.delete(messageId);
		const { threadMessagesDeleted } = await reconcileStaleMessage(
			deps,
			accountConfigId,
			messageId,
		);
		deps.log.info(
			{
				metric: "placement_move_stale_row_reconciled",
				accountId,
				accountConfigId,
				messageId,
				uid,
				sourceMailboxPath,
				threadMessagesDeleted,
			},
			"Message no longer at its pending-move source after retry exhaustion (external delete or move); marker dropped, stale row reconciled",
		);
		return { outcome: "reconciled" };
	}

	await deps.markerService.delete(messageId);
	await restoreSourcePlacement(deps, {
		accountConfigId,
		messageId,
		sourceMailboxId,
		uid,
		syncStatus: MessageSyncStatus.synced,
	});

	deps.log.error(
		{
			alert: "placement_move_failed",
			accountId,
			accountConfigId,
			messageId,
			uid,
			sourceMailboxId,
			sourceMailboxPath,
		},
		"Placement move could not be pushed to IMAP after retry exhaustion; message still exists at its source — row restored to the source pair, marker dropped, alert left for operator investigation",
	);
	return { outcome: "broken" };
};
