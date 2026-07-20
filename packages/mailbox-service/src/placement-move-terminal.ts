import { isMessageGoneFromOpenMailbox } from "./message-presence.js";
import type { PlacementMoveLogger } from "./placement-move.js";
import {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "./stale-message-reconcile.js";
import type { IImapConnection } from "./types.js";

export interface ResolveExhaustedPlacementMoveDeps
	extends StaleMessageReconcileDeps {
	markerService: { delete(messageId: string): Promise<void> };
	log: PlacementMoveLogger;
}

export interface ResolveExhaustedPlacementMoveInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	uid: number;
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
 *    than by a FETCH coming back empty. Per invariant 2, an external delete supersedes the
 *    marker entirely: the marker is dropped and the stale Message/ThreadMessage
 *    rows are deleted via {@link reconcileStaleMessage}. This is also the
 *    outcome for the (rarer, functionally indistinguishable from here) case
 *    where a foreign client moved the message elsewhere — either way, our
 *    prediction no longer holds, and the marker cannot be honoured. Metric
 *    only, no alarm — routine.
 * 2. BROKEN — the message still exists at the source, but the move keeps
 *    failing. This indicates broken code or a broken account (issue #1271),
 *    not a transient blip. The marker is left in place (not cleared) so a
 *    later resync can never "correct" the message back to its server
 *    location out from under an operator's investigation — dropping it here
 *    would remove the very lock rule 3 depends on. Logged with an
 *    `alert`-shaped entry for an operator alarm; never re-thrown (terminal —
 *    the caller acks either way, since retrying a stale or permanently-broken
 *    move can never succeed).
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

	deps.log.error(
		{
			alert: "placement_move_failed",
			accountId,
			accountConfigId,
			messageId,
			uid,
			sourceMailboxPath,
		},
		"Placement move could not be pushed to IMAP after retry exhaustion; message still exists at its source — marker left pending for operator investigation",
	);
	return { outcome: "broken" };
};
