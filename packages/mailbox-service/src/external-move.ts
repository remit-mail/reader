import type {
	IMailboxRepository,
	IMessageRepository,
	MailboxItem,
	MessageItem,
} from "@remit/data-ports";
import { isVirtualCopyMailbox } from "@remit/data-ports/virtual-copy";
import { MessageStatus } from "@remit/domain-enums";
import type { IImapConnection } from "./types.js";

export interface ExternalMoveLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Whether a sighting of an already-stored message in this mailbox CONTESTS the
 * placement the row holds (#859). Contesting is not deciding: the sighting is a
 * candidate move, and {@link confirmDepartures} is what turns it into one.
 *
 * Three sightings do not even contest. The same mailbox is the row standing
 * where it already is. Gmail's All Mail, Starred and Important hold every
 * message that also lives in a real folder, so they are views rather than filing
 * locations; following one would empty every other folder's listing. And a row
 * whose own mutation has not settled is in flight, not stale
 * (imap-mutations R1): the server's answer predates the move reader is still
 * waiting on, so taking it would undo the optimistic write. The sync path
 * reconciles rather than waits (imap-mutations R2): it never blocks on a
 * mutation, it re-reads the row on the next sighting after the move settles.
 *
 * In flight is `status`, and `status` alone (#1096, imap-mutations R3). Every
 * outbound mutation writes `moving` or `deleting` and only settling returns the
 * row to `active`, so `active` is precisely the set nothing is coming for —
 * whatever `syncStatus` says about how the row got there. A row put back by
 * `abandonDelete` carries `abandoned`, and it needs this repair more than any
 * other row does: nothing routine settles it, and reader shares its mailboxes,
 * so refusing it left a message whose delete was refused unable to follow a
 * move the user then made in another client.
 */
export const sightingContestsPlacement = (
	mailbox: MailboxItem,
	message: Pick<MessageItem, "mailboxId" | "status">,
): boolean => {
	if (message.mailboxId === mailbox.mailboxId) return false;
	if (isVirtualCopyMailbox(mailbox)) return false;
	return message.status === MessageStatus.active;
};

/**
 * The exact placement a verdict was reached for. The probe reads the row outside
 * the transaction that acts on it, so the verdict names the mailbox and uid it
 * was reached for; a row that moved in between matches no verdict and is left
 * unsettled.
 */
export const placementKey = (
	messageId: string,
	mailboxId: string,
	uid: number,
): string => `${messageId}:${mailboxId}:${uid}`;

export interface DepartureVerdicts {
	/**
	 * Placements the source folder no longer holds. A sighting elsewhere of one
	 * of these is a move, and re-points the row.
	 */
	departed: Set<string>;
	/**
	 * Placements a verdict was reached for at all, departed or still held. A
	 * contested sighting outside this set was not decided — the source could not
	 * be asked, or the row has moved since it was — and its uid is held back from
	 * the watermark so the next round serves the sighting again. Without that a
	 * single unanswerable round would leave the row mispointed until a cursor
	 * rebuild, which is the silent never-repair this whole change is about.
	 */
	settled: Set<string>;
}

export interface DepartureProbeDeps {
	connection: Pick<IImapConnection, "openBox" | "search">;
	mailboxService: Pick<IMailboxRepository, "get">;
	messageService: Pick<IMessageRepository, "get">;
	log: ExternalMoveLogger;
}

/**
 * Which of this batch's messages have really left the folder their row points at
 * (#1146).
 *
 * A message sighted in a second real folder has not necessarily moved. Living in
 * two folders at once is ordinary mail: a Gmail user label, a Sieve `fileinto`
 * beside a `keep`, a Sent copy a mailing list echoes back. Reading every such
 * sighting as a move takes the message out of the folder it is still in, and
 * whichever folder the sync round enumerates last wins — which is how a labelled
 * message disappeared from the Inbox on the next sync.
 *
 * What separates a move from a copy is the source folder: a move empties it, a
 * copy leaves it alone. So the source is asked, and only a source that no longer
 * holds the uid the row claims makes the sighting a move. A move another client
 * made is still followed — that is the case where the source really is empty —
 * and reader stops fighting a second client over mail neither of them moved.
 *
 * The question is asked with a UID SEARCH rather than a FETCH, for the reason
 * `isMessageGoneFromOpenMailbox` documents: imapflow drops rows on back-to-back
 * FETCHes (#408), and absence read off a FETCH would file live mail as departed.
 * `IImapConnection.search` throws on a failed SEARCH, so an empty answer means
 * the server matched nothing. The SEARCH names the contested uids rather than
 * ALL: the answer needed is about those uids, and a folder's whole uid set is a
 * page of traffic per batch for an account with a large Inbox.
 *
 * One SEARCH per source folder per batch, and no IMAP at all when nothing is
 * contested — which is every round on an account whose folders do not overlap.
 */
export const confirmDepartures = async (
	deps: DepartureProbeDeps,
	accountId: string,
	sightedIn: MailboxItem,
	messageIds: string[],
): Promise<DepartureVerdicts> => {
	const verdicts: DepartureVerdicts = {
		departed: new Set<string>(),
		settled: new Set<string>(),
	};
	if (messageIds.length === 0) return verdicts;

	const stored = await deps.messageService.get(messageIds);
	// A row carrying no uid names no placement the source can be asked about, so
	// it reaches no verdict here and its sighting is served again next round. It
	// is not reachable from a sync — `upsertWithStatus` writes the uid the FETCH
	// returned — and a folder that somehow produces one stalls its cursor and
	// raises the alert rather than repairing a row against nothing.
	const contested = stored.filter(
		(row) => row.uid > 0 && sightingContestsPlacement(sightedIn, row),
	);
	if (contested.length === 0) return verdicts;

	const bySource = new Map<string, MessageItem[]>();
	for (const row of contested) {
		const group = bySource.get(row.mailboxId);
		if (group === undefined) {
			bySource.set(row.mailboxId, [row]);
			continue;
		}
		group.push(row);
	}

	for (const [sourceMailboxId, rows] of bySource) {
		await askSource(
			deps,
			accountId,
			sightedIn,
			sourceMailboxId,
			rows,
			verdicts,
		);
	}

	return verdicts;
};

/**
 * What one source folder said about the rows pointed at it. Only `holds` decides
 * anything; the other three are the folder declining to be evidence, each for
 * its own reason and each leaving the sightings to come back next round.
 */
type SourceAnswer =
	| { kind: "holds"; path: string; held: Set<number> }
	| { kind: "copiesEverything"; path: string }
	| { kind: "rekeyed"; path: string; stored: number; served: number }
	| { kind: "unreachable"; reason: string };

const readSource = async (
	deps: DepartureProbeDeps,
	accountId: string,
	sourceMailboxId: string,
	rows: MessageItem[],
): Promise<SourceAnswer> => {
	const source = await deps.mailboxService.get(accountId, sourceMailboxId);

	// A row whose source is All Mail, Starred or Important is not filed there:
	// those folders hold a copy of everything and never release anything, so
	// asking them would answer "still here" forever and freeze the row on a view.
	if (isVirtualCopyMailbox(source)) {
		return { kind: "copiesEverything", path: source.fullPath };
	}

	const box = await deps.connection.openBox(source.fullPath, true);

	// A source folder on a different UIDVALIDITY axis holds no uid these rows can
	// be compared against, so its message set is evidence of nothing (RFC 9051
	// 2.3.1.1). The cursor rebuild re-keys that folder; until it has, the
	// sightings stay unsettled and come back next round.
	if (box.uidvalidity !== source.uidValidity) {
		return {
			kind: "rekeyed",
			path: source.fullPath,
			stored: source.uidValidity,
			served: box.uidvalidity,
		};
	}

	const held = await deps.connection.search([
		["UID", rows.map((row) => row.uid).join(",")],
	]);
	return { kind: "holds", path: source.fullPath, held: new Set(held) };
};

const askSource = async (
	deps: DepartureProbeDeps,
	accountId: string,
	sightedIn: MailboxItem,
	sourceMailboxId: string,
	rows: MessageItem[],
	verdicts: DepartureVerdicts,
): Promise<void> => {
	const settle = (row: MessageItem, departed: boolean): void => {
		const key = placementKey(row.messageId, row.mailboxId, row.uid);
		verdicts.settled.add(key);
		if (departed) verdicts.departed.add(key);
	};

	// A source folder reader cannot reach decides nothing, and does not fail the
	// round either. Another client renaming or deleting it between the row being
	// written and now is ordinary — reader shares its mailboxes — and the sync of
	// the unrelated folder that sighted these messages must survive it.
	const answer = await readSource(
		deps,
		accountId,
		sourceMailboxId,
		rows,
	).catch<SourceAnswer>((error: unknown) => ({
		kind: "unreachable",
		reason: error instanceof Error ? error.message : String(error),
	}));

	const observed = {
		sourceMailboxId,
		sightedMailboxId: sightedIn.mailboxId,
		contested: rows.length,
	};

	if (answer.kind === "unreachable") {
		deps.log.warn(
			{ ...observed, error: answer.reason },
			"Could not ask the source folder whether it still holds these messages; leaving the sightings unsettled this round",
		);
		return;
	}

	if (answer.kind === "rekeyed") {
		deps.log.warn(
			{
				...observed,
				sourceMailboxPath: answer.path,
				storedUidValidity: answer.stored,
				servedUidValidity: answer.served,
			},
			"Source folder is on a different UIDVALIDITY axis; leaving these sightings unsettled this round",
		);
		return;
	}

	if (answer.kind === "copiesEverything") {
		for (const row of rows) settle(row, true);
		deps.log.info(
			{ ...observed, sourceMailboxPath: answer.path },
			"Row points at a folder that copies every message; the sighting in a real folder is where it lives",
		);
		return;
	}

	for (const row of rows) settle(row, !answer.held.has(row.uid));
};
