import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { ConflictError, NotFoundError } from "@remit/data-ports/errors";
import { rebaseMailboxPath } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { isNotFoundError } from "./mailbox-presence.js";

/**
 * The states a rename or a delete intent may be recorded from (T4, T7). Both
 * failed variants are legal starting points — a retry re-records the same
 * intent on the same row, so no duplicate folder can be created — and every
 * other state means a mutation is already in flight on the folder.
 */
export const INTENT_RECORDABLE_FROM = [
	MailboxSyncStatus.synced,
	MailboxSyncStatus.failed,
] as const;

const carriesIntent = (row: Pick<MailboxItem, "syncStatus">): boolean =>
	(INTENT_RECORDABLE_FROM as readonly string[]).includes(row.syncStatus);

/**
 * Whether a row was written by one particular rename intent
 * (docs/architecture/folder-rename-and-delete.md D15).
 *
 * A recorded target that merely sits at or under the rename's target is not
 * enough to identify one. Two folders can hold targets under the same path —
 * `Work → Projects` in flight while `Other → Projects/Old` is recorded — and a
 * settle that claimed both would stamp a row this rename never touched onto a
 * path it never asked for, leaving that folder's own rename unrepresented and
 * two rows claiming one path for the sweep to reap and re-insert.
 *
 * The identity is the pair: the row sits at or under the path the rename is
 * leaving, **and** the target it recorded is exactly what this rename's own
 * rebase would have written for it. Nothing but this intent writes that pair,
 * because the intent is recorded over one subtree in one transaction (D6) and
 * the transition is the only writer of either field (D3).
 */
export const recordedByRename = (
	row: Pick<MailboxItem, "fullPath" | "pendingPath">,
	oldPath: string,
	newPath: string,
	delimiter: string,
): boolean =>
	row.pendingPath !== undefined &&
	rebaseMailboxPath(row.fullPath, oldPath, newPath, delimiter) ===
		row.pendingPath;

/**
 * What is already happening to a folder, as a clause naming the folder. The
 * six states, not the four enum values: `pending` covers a create in flight and
 * a rename in flight, and only `pendingPath` tells them apart.
 */
const inFlight = (row: MailboxItem): string => {
	if (row.syncStatus === MailboxSyncStatus.deleting) {
		return `A delete is already in progress for "${row.fullPath}"`;
	}
	if (row.pendingPath !== undefined) {
		return `A rename is in progress for "${row.fullPath}"`;
	}
	return `"${row.fullPath}" is still being created`;
};

/**
 * Say why a folder intent lost its compare-and-set (D3).
 *
 * Existence was established by the read the caller took before recording, so a
 * lost predicate is a conflict rather than a 404 — but the row can have gone in
 * between, and one primary-key read tells the two apart. For a subtree intent
 * the blocker may be a descendant, and the message says so: a subtree cannot be
 * half-renamed (D6), so a descendant mid-mutation refuses the whole rename and
 * a user who was not thinking about it has to be told which folder it is.
 *
 * Always rejects.
 */
export const refuseContestedIntent = async (
	mailboxService: Pick<IMailboxRepository, "get" | "findByPathPrefix">,
	accountId: string,
	mailboxId: string,
	scope: "folder" | "subtree",
): Promise<never> => {
	const root = await mailboxService
		.get(accountId, mailboxId)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return undefined;
			throw error;
		});
	if (!root) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);

	if (!carriesIntent(root)) throw new ConflictError(`${inFlight(root)}.`);

	const descendants =
		scope === "subtree"
			? await mailboxService.findByPathPrefix(
					accountId,
					root.fullPath,
					root.hierarchyDelimiter,
				)
			: [];
	const blocking = descendants.find((row) => !carriesIntent(row));
	if (blocking) {
		throw new ConflictError(`${inFlight(blocking)}, inside this folder.`);
	}

	// Every row reads recordable now, so the row that blocked has already moved
	// on. Nothing to name, and the same request succeeds on a retry.
	throw new ConflictError(
		`"${root.fullPath}" changed while this request was being recorded. Try again.`,
	);
};
