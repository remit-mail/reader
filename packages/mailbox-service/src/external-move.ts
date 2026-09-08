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
 * The exact placement a departure was confirmed against. The probe reads the row
 * outside the transaction that acts on it, so the verdict names the mailbox and
 * uid it was reached for; a row that moved in between no longer matches and is
 * left for the next round.
 */
export const placementKey = (
	messageId: string,
	mailboxId: string,
	uid: number,
): string => `${messageId}:${mailboxId}:${uid}`;

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
 * the server matched nothing.
 *
 * One SEARCH per source folder per batch, and no IMAP at all when nothing is
 * contested — which is every round on an account whose folders do not overlap.
 */
export const confirmDepartures = async (
	deps: DepartureProbeDeps,
	accountId: string,
	sightedIn: MailboxItem,
	messageIds: string[],
): Promise<Set<string>> => {
	const departed = new Set<string>();
	if (messageIds.length === 0) return departed;

	const stored = await deps.messageService.get(messageIds);
	const contested = stored.filter(
		(row) => row.uid > 0 && sightingContestsPlacement(sightedIn, row),
	);
	if (contested.length === 0) return departed;

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
		const source = await deps.mailboxService.get(accountId, sourceMailboxId);
		const box = await deps.connection.openBox(source.fullPath, true);

		// A source folder on a different UIDVALIDITY axis holds no uid these rows
		// can be compared against, so its message set is evidence of nothing (RFC
		// 9051 2.3.1.1). The cursor rebuild re-keys that folder; until it has, a
		// sighting elsewhere waits rather than being read as a move.
		if (box.uidvalidity !== source.uidValidity) {
			deps.log.warn(
				{
					sourceMailboxId,
					sourceMailboxPath: source.fullPath,
					storedUidValidity: source.uidValidity,
					servedUidValidity: box.uidvalidity,
					contested: rows.length,
				},
				"Source folder is on a different UIDVALIDITY axis; leaving these sightings unfollowed this round",
			);
			continue;
		}

		const held = new Set(await deps.connection.search(["ALL"]));
		for (const row of rows) {
			if (held.has(row.uid)) {
				deps.log.info(
					{
						messageId: row.messageId,
						sourceMailboxId,
						sourceUid: row.uid,
						sightedMailboxId: sightedIn.mailboxId,
					},
					"Message is still in the folder its row points at; the sighting is a second copy, not a move",
				);
				continue;
			}
			departed.add(placementKey(row.messageId, row.mailboxId, row.uid));
		}
	}

	return departed;
};
