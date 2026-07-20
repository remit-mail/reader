import type { FlagPushLogger } from "./flag-push.js";
import { isMessageGoneFromOpenMailbox } from "./message-presence.js";
import {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "./stale-message-reconcile.js";
import type { IImapConnection } from "./types.js";

export interface ResolveExhaustedFlagPushDeps
	extends StaleMessageReconcileDeps {
	markerService: { delete(messageId: string, flagName: string): Promise<void> };
	log: FlagPushLogger;
}

export interface ResolveExhaustedFlagPushInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	flagName: string;
	uid: number;
	mailboxPath: string;
	getConnection: () => Promise<IImapConnection>;
}

export type FlagPushTerminalOutcome = "reconciled" | "broken";

export interface ResolveExhaustedFlagPushResult {
	outcome: FlagPushTerminalOutcome;
}

/**
 * Resolve a FLAG_PUSH failure that has exhausted the delivering queue's
 * redelivery budget into exactly one of two terminal outcomes, mirroring
 * `resolveExhaustedPlacementMoveFailure` (#1289) and
 * `resolveExhaustedBodySyncFailures` (#1270) for the same failure taxonomy
 * (epic #1281 invariant 3) — no third, softer outcome.
 *
 * 1. RECONCILED (expected) — the message no longer exists at its mailbox on
 *    IMAP, confirmed by {@link isMessageGoneFromOpenMailbox} rather than by a
 *    FETCH coming back empty. Per invariant 2, an external delete supersedes the marker
 *    entirely: the marker is dropped and the stale Message/ThreadMessage rows
 *    are deleted via {@link reconcileStaleMessage}. Metric only, no alarm —
 *    routine.
 * 2. BROKEN — the message still exists, but the flag push keeps failing.
 *    Broken code or a broken account, not a transient blip. The marker is
 *    left in place (not cleared) — while pending, resync never reverts the
 *    local flag (invariant 3 of this issue's own spec), so leaving it does
 *    not risk correctness, and dropping it here would discard the only
 *    record that IMAP still owes this push. Logged with an `alert`-shaped
 *    entry for an operator alarm; never re-thrown (terminal — the caller acks
 *    either way, since retrying a stale or permanently-broken push can never
 *    succeed).
 */
export const resolveExhaustedFlagPushFailure = async (
	deps: ResolveExhaustedFlagPushDeps,
	input: ResolveExhaustedFlagPushInput,
): Promise<ResolveExhaustedFlagPushResult> => {
	const {
		accountId,
		accountConfigId,
		messageId,
		flagName,
		uid,
		mailboxPath,
		getConnection,
	} = input;

	const connection = await getConnection();
	await connection.openBox(mailboxPath, true);

	if (await isMessageGoneFromOpenMailbox(connection, uid)) {
		await deps.markerService.delete(messageId, flagName);
		const { threadMessagesDeleted } = await reconcileStaleMessage(
			deps,
			accountConfigId,
			messageId,
		);
		deps.log.info(
			{
				metric: "flag_push_stale_row_reconciled",
				accountId,
				accountConfigId,
				messageId,
				flagName,
				uid,
				mailboxPath,
				threadMessagesDeleted,
			},
			"Message no longer at its flag-push mailbox after retry exhaustion (external delete); marker dropped, stale row reconciled",
		);
		return { outcome: "reconciled" };
	}

	deps.log.error(
		{
			alert: "flag_push_failed",
			accountId,
			accountConfigId,
			messageId,
			flagName,
			uid,
			mailboxPath,
		},
		"Flag push could not be pushed to IMAP after retry exhaustion; message still exists — marker left pending for operator investigation",
	);
	return { outcome: "broken" };
};
