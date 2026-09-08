import type {
	MailboxResponse,
	RenameMailboxInput,
} from "@remit/api-openapi-types";
import type { IAccountSettingRepository, MailboxItem } from "@remit/data-ports";
import {
	BadRequestError,
	ForbiddenError,
	MailboxNotSettledError,
	NotFoundError,
} from "@remit/data-ports/errors";
import { isReservedFolderName } from "@remit/data-ports/folder-role";
import { mailboxLeafName } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus, MessageSystemFlag } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import {
	applyPendingMoveCountPrediction,
	type PendingUnseenFlagPush,
} from "../derive/pendingMoveCounts.js";
import { getClient } from "../service/data-client.js";
import type {
	MailboxDetailOperationIds,
	MailboxOperationIds,
	OperationHandler,
	TrashOperationIds,
} from "../types.js";
import {
	applyMailboxOverrideChanges,
	loadMailboxOverrides,
	loadMailboxOverridesForConfig,
	type MailboxOverrides,
} from "./account-overrides.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { assertNoBindings, loadMailboxBindings } from "./mailbox-bindings.js";

/**
 * The mute flag and the display-name override are user preferences that live
 * in per-mailbox AccountSetting rows (RFC 032), not on the Mailbox entity.
 * Pick only those keys from a PATCH body: each follows the same `null` → remove,
 * value → set, absent/undefined → no-op semantics as UpdateAddressFlagsInput.
 * The canonical role a folder fills is appointed separately — see
 * FolderRoleOperations.appointFolderRole (RFC 032 exclusive-folder-appointment).
 */
export const pickMailboxOverrideChanges = (
	body: RenameMailboxInput,
): {
	displayNameOverride?: string | null;
	muted?: RenameMailboxInput["muted"];
} => {
	const changes: {
		displayNameOverride?: string | null;
		muted?: RenameMailboxInput["muted"];
	} = {};
	if (Object.hasOwn(body, "displayNameOverride")) {
		changes.displayNameOverride = body.displayNameOverride;
	}
	if (Object.hasOwn(body, "muted")) {
		changes.muted = body.muted;
	}
	return changes;
};

/**
 * Minimal client surface needed to apply a mailbox PATCH. Structurally
 * satisfied by RemitClient; narrowed so tests can stub it.
 */
export interface MailboxPatchClient {
	mailbox: {
		get(accountId: string, mailboxId: string): Promise<MailboxItem>;
		listAllByAccount(accountId: string): Promise<MailboxItem[]>;
	};
	mailboxQueue: {
		renameMailbox(
			mailboxId: string,
			newPath: string,
			accountId: string,
		): Promise<MailboxItem>;
		dismissMailboxIntent(
			mailboxId: string,
			accountId: string,
		): Promise<MailboxItem>;
	};
	accountSetting: Pick<IAccountSettingRepository, "get" | "upsert" | "delete">;
}

/**
 * Refuse a rename that no retry of the same request could ever satisfy (D4).
 *
 * `INBOX` is refused at both ends: renaming it moves its mail to the new name
 * and leaves an empty INBOX behind, and renaming anything *to* it collides with
 * the one name RFC 3501 reserves (D5).
 *
 * A reserved leaf name is refused for a different reason. The mailbox sweep
 * reads a folder whose leaf name is a role's conventional name but which lacks
 * the server's flag as a duplicate, and deletes its row — under D8, with the
 * folder's mail — as soon as another folder holds the flag. A rename to such a
 * name settles `synced` and is then reaped. Refusing at the API is the same
 * class of check as the rest of D4 and does not require teaching that heuristic
 * about renames.
 */
const assertRenameTargetAllowed = async (
	client: Pick<MailboxPatchClient, "mailbox">,
	accountId: string,
	before: MailboxItem,
	target: string,
): Promise<void> => {
	if (before.fullPath.toUpperCase() === "INBOX") {
		throw new BadRequestError("The inbox can't be renamed.");
	}
	if (target.trim().length === 0) {
		throw new BadRequestError("A folder needs a name.");
	}
	if (target.toUpperCase() === "INBOX") {
		throw new BadRequestError("“INBOX” is reserved for the inbox.");
	}

	const leaf = mailboxLeafName({
		fullPath: target,
		hierarchyDelimiter: before.hierarchyDelimiter,
	});
	if (isReservedFolderName(leaf)) {
		throw new BadRequestError(
			`“${leaf}” is reserved for a system folder. Pick another name.`,
		);
	}

	// A path a rename is on its way to is as taken as one a folder already sits
	// at (D2). Reading `fullPath` alone accepts a second rename onto a target
	// another is already recorded for: both settle, both write the same path,
	// and the sweep then reaps one row — with its mail — and inserts a duplicate
	// for the survivor's path. The account's folders are few and the sweep
	// already reads them all, so one pass answers both questions.
	const folders = await client.mailbox.listAllByAccount(accountId);
	for (const folder of folders) {
		if (folder.mailboxId === before.mailboxId) continue;
		if (folder.fullPath === target) {
			throw new BadRequestError(`A folder named “${target}” is already there.`);
		}
		// `pending` only. A failed rename keeps its target so the client can name
		// what it was aiming at and offer a retry (T6), and nothing clears it
		// until the user retries or dismisses — so honouring a `failed` row's
		// claim would tell everyone else the path is taken by a rename that is
		// not happening, with no way to find that out and nothing to wait for.
		if (
			folder.syncStatus === MailboxSyncStatus.pending &&
			folder.pendingPath === target
		) {
			throw new BadRequestError(
				`“${folder.fullPath}” is already being renamed to “${target}”.`,
			);
		}
	}
};

/**
 * Apply a mailbox PATCH body: override changes first (mute flag + display-name/
 * role overrides — written to per-mailbox AccountSetting rows, no IMAP
 * machinery), then rename — which triggers the IMAP rename machinery
 * (the recorded subtree intent + MAILBOX_RENAME event) — only when `fullPath`
 * is present. An override-only PATCH therefore never calls
 * `mailboxQueue.renameMailbox`.
 *
 * A `fullPath` equal to the row's confirmed one is not a rename: it is the
 * dismissal of a failed intent (T10, T11), which is how a user keeps the name
 * the folder already has without new API surface. It is checked first, because
 * from `failed` it is the one route out that enqueues nothing.
 */
export const applyMailboxPatch = async (
	client: MailboxPatchClient,
	accountConfigId: string,
	mailboxId: string,
	accountId: string,
	body: RenameMailboxInput,
): Promise<MailboxItem> => {
	const { fullPath } = body;

	// --- Override settings (mute flag + display-name/role overrides) ---
	// Written to per-mailbox AccountSetting rows (RFC 032) with the same
	// null→remove semantics as UpdateAddressFlagsInput. Applied before (and
	// independent of) any rename so an override-only PATCH never touches the
	// row's mutation state.
	const changes = pickMailboxOverrideChanges(body);
	if (Object.keys(changes).length > 0) {
		await applyMailboxOverrideChanges(
			client.accountSetting,
			accountConfigId,
			mailboxId,
			changes,
		);
	}

	// --- Rename (IMAP machinery) ---
	// Only triggered when fullPath is present.
	if (!fullPath) {
		return client.mailbox.get(accountId, mailboxId);
	}

	const before = await client.mailbox.get(accountId, mailboxId);
	if (fullPath === before.fullPath) {
		return client.mailboxQueue.dismissMailboxIntent(mailboxId, accountId);
	}

	await assertRenameTargetAllowed(client, accountId, before, fullPath);

	// The row keeps the path the server holds until the rename settles (D2), so
	// nothing that names a folder by path moves here — the appointment labels
	// recorded beside each role (#887) included. They move with the settle.
	return client.mailboxQueue.renameMailbox(mailboxId, fullPath, accountId);
};

/**
 * Cross-account guard for a mailbox reached by id under an `accountId` path.
 * `assertAccountOwnership` only proves the caller owns the account in the path;
 * the `mailboxId` in that same path can belong to a different account, so without
 * this check a caller could read or mutate another account's mailbox. Mirrors the
 * read/act split of `assertAccountOwnership`: 404 on a read (no existence leak),
 * 403 on an action.
 */
export const assertMailboxInAccount = (
	mailbox: Pick<MailboxItem, "mailboxId" | "accountId">,
	accountId: string,
	mode: "read" | "act",
): void => {
	if (mailbox.accountId === accountId) return;
	if (mode === "read") {
		throw new NotFoundError(`Mailbox not found: ${mailbox.mailboxId}`);
	}
	throw new ForbiddenError(`Mailbox ${mailbox.mailboxId} not in account`);
};

/**
 * Why a folder cannot be bound to yet, per state — one wording in one place,
 * because the remedy differs and the client has only the sentence to show.
 */
const UNSETTLED_REASON: Record<string, (path: string) => string> = {
	[MailboxSyncStatus.pending]: (path) =>
		`“${path}” isn’t ready yet — the mail server hasn’t confirmed it.`,
	[MailboxSyncStatus.deleting]: (path) => `“${path}” is being deleted.`,
	[MailboxSyncStatus.failed]: (path) =>
		`The last change to “${path}” failed. Retry or dismiss it first.`,
};

/**
 * Every API write that binds a durable reference to a mailbox requires that
 * mailbox to be `synced` (D12, first row; imap-mutations R2: wait). A dangling
 * reference is permanent; blocking costs seconds.
 *
 * This is the server-side floor under the client-side wait, and it is not
 * redundant with it: there is more than one client, and a script hitting the
 * API directly gets no wait at all.
 *
 * It is the other half of D16. A binding is only ever created against a settled
 * folder (here) and only ever removed by the user (the delete refusal below),
 * so a `mailboxId` that names nothing never exists — which is what lets every
 * reader of a filter's `actionMailboxId` or a role appointment treat the
 * reference as resolvable, with no missing-target branch.
 *
 * A `\Noselect` container is refused by construction — mailbox-sync keeps no
 * row for one — so there is nothing to bind to. Clearing a reference is not a
 * bind and is never gated, and neither is a move *out of* a folder: a
 * `deleting` folder still holds its mail until the DELETE lands, which is the
 * delete-with-move flow (D13).
 */
export const assertMailboxSettled = (
	target: Pick<MailboxItem, "mailboxId" | "fullPath" | "syncStatus">,
): void => {
	const reason = UNSETTLED_REASON[target.syncStatus];
	if (!reason) return;
	throw new MailboxNotSettledError(
		reason(target.fullPath),
		target.mailboxId,
		target.syncStatus,
	);
};

/**
 * Every pending placement move (issue #1271) for an account, on whichever
 * backend is active (`RemitClient.placementMove` is present on both — see
 * `create-remit-client.ts`). Read-only; feeds
 * `applyPendingMoveCountPrediction`'s read-time adjustment only, never mutates
 * stored counts (epic #1281 invariant 4). Markers are written by the
 * imap-worker bulk sync path through `RemitClient.placementMove` on every
 * backend, so this is a real signal on the self-host stack too.
 */
const loadPendingMoves = (
	client: Awaited<ReturnType<typeof getClient>>,
	accountId: string,
) => client.placementMove.listByAccountId(accountId);

/**
 * Every pending `\Seen` flag-push marker (issue #1273) for an account —
 * `\Flagged` (star) markers are excluded, since only read/unread state feeds
 * `unseenCount`'s prediction. `RemitClient.flagPush` is present and WRITTEN
 * on both backends, so this is a real signal on the self-host stack too.
 */
const loadPendingUnseenFlagPushes = async (
	client: Awaited<ReturnType<typeof getClient>>,
	accountId: string,
): Promise<PendingUnseenFlagPush[]> => {
	const pushes = await client.flagPush.listByAccountId(accountId);
	return pushes
		.filter((push) => push.flagName === MessageSystemFlag.Seen)
		.map((push) => ({ mailboxId: push.mailboxId, operation: push.operation }));
};

const toMailboxResponse = (
	mailbox: MailboxItem,
	overrides: MailboxOverrides = {},
): MailboxResponse => ({
	mailboxId: mailbox.mailboxId,
	accountId: mailbox.accountId,
	namespaceType: mailbox.namespaceType,
	namespacePrefix: mailbox.namespacePrefix,
	hierarchyDelimiter: mailbox.hierarchyDelimiter,
	fullPath: mailbox.fullPath,
	messageCount: mailbox.messageCount,
	unseenCount: mailbox.unseenCount,
	deletedCount: mailbox.deletedCount,
	specialUse: mailbox.specialUse ? Array.from(mailbox.specialUse) : undefined,
	lastSyncUid: mailbox.lastSyncUid,
	highWaterMarkUid: mailbox.highWaterMarkUid,
	lastMessageSyncAt: mailbox.lastMessageSyncAt,
	syncStatus: mailbox.syncStatus,
	// The row is the only thing that knows what a rename is aiming at, and
	// `fullPath` stays the confirmed one throughout (D2), so without this a
	// client cannot tell a create in flight from a rename in flight, name the
	// target of a failed rename, or offer the right retry.
	pendingPath: mailbox.pendingPath,
	muted: overrides.muted,
	displayNameOverride: overrides.displayNameOverride,
	createdAt: mailbox.createdAt,
	updatedAt: mailbox.updatedAt,
});

export const MailboxOperations: Record<
	MailboxOperationIds,
	OperationHandler<MailboxOperationIds>
> = {
	MailboxOperations_listMailboxes: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const result = await client.mailbox.listByAccount(accountId, {
			continuationToken,
		});

		// Overrides (mute / display-name / role) live in per-mailbox AccountSetting
		// rows (RFC 032). Load the whole config's set in one query and key it by
		// mailboxId so each mailbox surfaces its overrides without an N+1.
		const overridesByMailbox = await loadMailboxOverridesForConfig(
			client.accountSetting,
			accountConfigId,
		);

		// Read-time prediction for any pending placement move (issue #1271) and
		// pending \Seen flag push (issue #1273) — adjusts messageCount /
		// unseenCount only, never the stored row (epic #1281 invariant 4).
		const pendingMoves = await loadPendingMoves(client, accountId);
		const pendingUnseenFlagPushes = await loadPendingUnseenFlagPushes(
			client,
			accountId,
		);
		// A folder mid-mutation is listed, labelled (D11). Hiding a `deleting` one
		// made a delete that does not settle look like a folder that silently
		// vanished, while the server still held it.
		const items = applyPendingMoveCountPrediction(
			result.items,
			pendingMoves,
			pendingUnseenFlagPushes,
		);

		return {
			items: items.map((mailbox) =>
				toMailboxResponse(
					mailbox,
					overridesByMailbox.get(mailbox.mailboxId) ?? {},
				),
			),
			continuationToken: result.continuationToken,
		};
	},

	MailboxOperations_createMailbox: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const { namespaceType, fullPath } = context.request.requestBody as {
			namespaceType: string;
			fullPath: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const mailbox = await client.mailboxQueue.createMailbox(
			{
				accountId,
				namespaceType: namespaceType as "personal" | "other_users" | "shared",
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath,
				uidValidity: 0,
				uidNext: 1,
				highestModseq: "0",
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			},
			accountId,
			true,
		);

		return toMailboxResponse(mailbox);
	},
};

export const MailboxDetailOperations: Record<
	MailboxDetailOperationIds,
	OperationHandler<MailboxDetailOperationIds>
> = {
	MailboxDetailOperations_getMailbox: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, mailboxId } = context.request.params as {
			accountId: string;
			mailboxId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const mailbox = await client.mailbox.get(accountId, mailboxId);
		assertMailboxInAccount(mailbox, accountId, "read");
		const overrides = await loadMailboxOverrides(
			client.accountSetting,
			accountConfigId,
			mailboxId,
		);

		// Read-time prediction for any pending placement move (issue #1271) and
		// pending \Seen flag push (issue #1273) — adjusts messageCount /
		// unseenCount only, never the stored row (epic #1281 invariant 4).
		const pendingMoves = await loadPendingMoves(client, accountId);
		const pendingUnseenFlagPushes = await loadPendingUnseenFlagPushes(
			client,
			accountId,
		);
		const adjusted =
			applyPendingMoveCountPrediction(
				[mailbox],
				pendingMoves,
				pendingUnseenFlagPushes,
			)[0] ?? mailbox;

		return toMailboxResponse(adjusted, overrides);
	},

	MailboxDetailOperations_renameMailbox: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, mailboxId } = context.request.params as {
			accountId: string;
			mailboxId: string;
		};
		const body = context.request.requestBody as RenameMailboxInput;

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const existing = await client.mailbox.get(accountId, mailboxId);
		assertMailboxInAccount(existing, accountId, "act");

		const mailbox = await applyMailboxPatch(
			client,
			accountConfigId,
			mailboxId,
			accountId,
			body,
		);
		const overrides = await loadMailboxOverrides(
			client.accountSetting,
			accountConfigId,
			mailboxId,
		);
		return toMailboxResponse(mailbox, overrides);
	},

	MailboxDetailOperations_deleteMailbox: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, mailboxId } = context.request.params as {
			accountId: string;
			mailboxId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const mailbox = await client.mailbox.get(accountId, mailboxId);
		assertMailboxInAccount(mailbox, accountId, "act");

		// Cheapest first (D4, D13). None of the three becomes possible by
		// retrying the same request, so all three are 400 and all three run
		// before anything is recorded.
		if (mailbox.fullPath.toUpperCase() === "INBOX") {
			throw new BadRequestError("The inbox can't be deleted.");
		}

		const children = await client.mailbox.findByPathPrefix(
			accountId,
			mailbox.fullPath,
			mailbox.hierarchyDelimiter,
		);
		if (children.length > 0) {
			// The server would keep the parent's name as a placeholder and leave the
			// children untouched — an outcome no local row describes (D9).
			throw new BadRequestError(
				`“${mailbox.fullPath}” has folders inside it. Delete those first.`,
			);
		}

		assertNoBindings(
			mailbox,
			await loadMailboxBindings(client, accountConfigId, accountId, mailboxId),
		);

		await client.mailboxQueue.deleteMailbox(mailboxId, accountId);
		return { statusCode: 204 };
	},
};

export const TrashOperations: Record<
	TrashOperationIds,
	OperationHandler<TrashOperationIds>
> = {
	TrashOperations_emptyTrash: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };

		const client = await getClient();

		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		// The service resolves Trash, marks the rows and counts them, all off one
		// read, and refuses with a coded 409 when the role is unresolved. Counting
		// here as well would be a second answer free to disagree with the one that
		// acts, and "0 deleted" reads as success to a user whose Trash is untouched.
		return client.messageMove.emptyTrash(accountConfigId, accountId);
	},
};
