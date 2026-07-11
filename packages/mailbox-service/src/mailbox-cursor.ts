import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import type { IImapConnection, ImapBoxStatus } from "./types.js";

/**
 * Detection + trip for the UIDVALIDITY cursor-integrity state machine (issue
 * #1272, epic #1281 invariant 5): `normal -> cursor_invalid -> rebuilding ->
 * normal`.
 *
 * A UIDVALIDITY bump invalidates every stored UID on a mailbox's axis
 * (RFC 9051 Section 2.3.1.1) — `lastSyncUid`, `highWaterMarkUid`, and every
 * per-message UID become meaningless the instant the server reports a
 * different value than what is stored. The state machine is persisted (not a
 * lock) because `MailboxLockService` only serializes one event type at a
 * time (`(mailboxId, eventName)` is its primary key) — it does not stop a
 * flag push from racing a sync round on the same mailbox. Every worker path
 * that SELECTs a mailbox calls {@link guardMailboxCursor} with the served
 * UIDVALIDITY right after opening the box, before issuing any command that
 * references a stored UID.
 */
export type MailboxCursorCheck =
	| { ok: true }
	| {
			ok: false;
			/** The state the mailbox is (now) in — always non-`normal` here. */
			state: "cursor_invalid" | "rebuilding";
	  };

export interface MailboxCursorGuardDeps {
	mailboxService: Pick<IMailboxRepository, "update">;
}

/**
 * `cursorState` is total per RFC 032 (defaults to `normal`) — but that default
 * only applies to rows written after this field existed. A row persisted
 * before this migration (DynamoDB attribute never written / Postgres column
 * genuinely NULL) reads back with the attribute absent despite the type
 * saying otherwise, so every consumer here treats `undefined` the same as
 * `normal` defensively rather than trusting the type.
 */
type MailboxCursorStateOrLegacyAbsent = MailboxItem["cursorState"] | undefined;

const isNormal = (state: MailboxCursorStateOrLegacyAbsent): boolean =>
	state === undefined || state === MailboxCursorState.normal;

/**
 * Compare a mailbox's stored UIDVALIDITY against what the server just served
 * (from an `openBox`/`STATUS` response) and act:
 *
 * - Already `cursor_invalid` or `rebuilding` — outbound IMAP is already
 *   paused for this mailbox; short-circuit without a write (frugal — epic
 *   #1281 invariant 6) and report why.
 * - `normal` but the served value disagrees with the stored one — trip the
 *   mailbox to `cursor_invalid` (the only write this function performs) and
 *   report the pause. This is the detection edge: whichever worker path
 *   notices the mismatch first is the one that flips the switch.
 * - `normal` and the values agree — proceed, nothing to do.
 *
 * Callers must treat a `{ ok: false }` result as an expected, routine pause
 * (epic #1281 invariant 3), not a fault: log/metric and skip the outbound
 * operation for this round rather than throwing.
 */
export const guardMailboxCursor = async (
	deps: MailboxCursorGuardDeps,
	accountId: string,
	mailbox: Pick<MailboxItem, "mailboxId" | "uidValidity"> & {
		cursorState: MailboxCursorStateOrLegacyAbsent;
	},
	servedUidValidity: number,
): Promise<MailboxCursorCheck> => {
	if (!isNormal(mailbox.cursorState)) {
		return {
			ok: false,
			state:
				mailbox.cursorState === MailboxCursorState.rebuilding
					? "rebuilding"
					: "cursor_invalid",
		};
	}

	if (mailbox.uidValidity !== servedUidValidity) {
		await deps.mailboxService.update(accountId, mailbox.mailboxId, {
			cursorState: MailboxCursorState.cursor_invalid,
		});
		return { ok: false, state: "cursor_invalid" };
	}

	return { ok: true };
};

/** True when a mailbox row is in either non-`normal` cursor state. */
export const isCursorRebuildNeeded = (
	cursorState: MailboxCursorStateOrLegacyAbsent,
): boolean =>
	cursorState === MailboxCursorState.cursor_invalid ||
	cursorState === MailboxCursorState.rebuilding;

/**
 * Thrown by the `openBox` override on a {@link guardConnectionCursor}-wrapped
 * connection when the mailbox cursor is (or just became) non-`normal`. Every
 * caller must treat this as the routine, expected pause described on {@link
 * guardMailboxCursor} — catch it around the outbound operation and skip
 * (ack/log/return), never let it surface as an infrastructure fault.
 */
export class MailboxCursorPausedError extends Error {
	constructor(readonly state: "cursor_invalid" | "rebuilding") {
		super(`Mailbox cursor is ${state}`);
		this.name = "MailboxCursorPausedError";
	}
}

/**
 * Wrap a live `IImapConnection` so its `openBox` is the single, structural
 * choke point for UIDVALIDITY cursor guarding (epic #1281 invariants 3 & 5).
 *
 * Every outbound IMAP operation that touches a stored UID requires an
 * `openBox`/SELECT first — that is an IMAP protocol requirement, not a
 * convention — so gating there means a caller cannot reach `fetchMessages`,
 * `addFlags`, `moveMessages`, `fetchMessageBody`, etc. against a paused
 * mailbox's stale axis without going through the same wrapped `openBox` this
 * function defines. A handler that forgets to call `guardMailboxCursor`
 * manually can no longer skip the check by omission; wiring a connection
 * through here makes that structural instead of per-callsite.
 *
 * - Already `cursor_invalid`/`rebuilding` — throws {@link
 *   MailboxCursorPausedError} immediately, without calling the real
 *   `openBox` (frugal — invariant 6, no network round-trip for a mailbox
 *   already known paused).
 * - `normal` but the served UIDVALIDITY disagrees — trips the mailbox (via
 *   {@link guardMailboxCursor}) and throws the same error.
 * - `normal` and it matches — delegates to the real `openBox` and returns
 *   normally.
 *
 * `mailbox` is a snapshot taken once by the caller (they already need it for
 * `mailboxPath`) — not re-fetched per call, so this adds no extra read.
 */
export const guardConnectionCursor = (
	connection: IImapConnection,
	deps: MailboxCursorGuardDeps,
	accountId: string,
	mailbox: Pick<MailboxItem, "mailboxId" | "uidValidity"> & {
		cursorState: MailboxCursorStateOrLegacyAbsent;
	},
): IImapConnection => {
	const guardedOpenBox = async (
		mailboxPath: string,
		readOnly?: boolean,
	): Promise<ImapBoxStatus> => {
		if (!isNormal(mailbox.cursorState)) {
			throw new MailboxCursorPausedError(
				mailbox.cursorState === MailboxCursorState.rebuilding
					? "rebuilding"
					: "cursor_invalid",
			);
		}

		const boxStatus = await connection.openBox(mailboxPath, readOnly);
		const check = await guardMailboxCursor(
			deps,
			accountId,
			mailbox,
			boxStatus.uidvalidity,
		);
		if (!check.ok) {
			throw new MailboxCursorPausedError(check.state);
		}
		return boxStatus;
	};

	return new Proxy(connection, {
		get(target, prop, receiver) {
			if (prop === "openBox") return guardedOpenBox;
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
};
