import type {
	CreateMailboxInput,
	MailboxResponse,
	RenameMailboxInput,
} from "@remit/api-openapi-types";
import type { IAccountSettingRepository, MailboxItem } from "@remit/data-ports";
import { BadRequestError, ConflictError } from "@remit/data-ports/errors";
import { MessageSystemFlag } from "@remit/domain-enums";
import {
	changeFolderPath,
	createFolder,
	type FolderPathDeps,
	folderInAccount,
	folderInFlight,
	ownedAccount,
} from "@remit/mailbox-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import {
	applyPendingMoveCountPrediction,
	type PendingUnseenFlagPush,
} from "../derive/pendingMoveCounts.js";
import { getClient } from "../service/data-client.js";
import { unwrap } from "../service/refusal.js";
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

export type MailboxPatchClient = FolderPathDeps & {
	accountSetting: Pick<IAccountSettingRepository, "get" | "upsert" | "delete">;
};

// Overrides land first and independently, so an override-only PATCH never
// touches the folder's mutation state.
export const applyMailboxPatch = async (
	client: MailboxPatchClient,
	accountConfigId: string,
	mailboxId: string,
	accountId: string,
	body: RenameMailboxInput,
): Promise<MailboxItem> => {
	const { fullPath } = body;
	const changes = pickMailboxOverrideChanges(body);
	if (Object.keys(changes).length > 0) {
		await applyMailboxOverrideChanges(
			client.accountSetting,
			accountConfigId,
			mailboxId,
			changes,
		);
	}

	if (!fullPath) {
		return client.mailbox.get(accountId, mailboxId);
	}

	const changed = await changeFolderPath(client, {
		accountId,
		mailboxId,
		fullPath,
	});
	if (!changed.ok && changed.refusal.kind === "NotSettled") {
		throw new ConflictError(changed.refusal.message);
	}
	const { outcome, mailbox } = unwrap(changed);
	if (outcome === "AlreadyRecorded") {
		throw new ConflictError(folderInFlight(mailbox));
	}
	return mailbox;
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
	syncFailureReason: mailbox.syncFailureReason,
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
		unwrap(ownedAccount(account, accountConfigId, "read"));

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
		const { namespaceType, fullPath } = context.request
			.requestBody as CreateMailboxInput;

		const created = await createFolder(await getClient(), accountConfigId, {
			accountId,
			namespaceType,
			fullPath,
		});
		const { outcome, mailbox } = unwrap(created);
		if (outcome === "Existing") {
			throw new BadRequestError(
				`A folder named “${fullPath}” is already there.`,
			);
		}
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
		unwrap(ownedAccount(account, accountConfigId, "read"));

		const mailbox = await client.mailbox.get(accountId, mailboxId);
		unwrap(folderInAccount(mailbox, accountId, "read"));
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
		unwrap(ownedAccount(account, accountConfigId, "act"));

		const existing = await client.mailbox.get(accountId, mailboxId);
		unwrap(folderInAccount(existing, accountId, "act"));

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
		unwrap(ownedAccount(account, accountConfigId, "act"));

		const mailbox = await client.mailbox.get(accountId, mailboxId);
		unwrap(folderInAccount(mailbox, accountId, "act"));

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
		unwrap(ownedAccount(account, accountConfigId, "act"));

		// The service resolves Trash, marks the rows and counts them, all off one
		// read, and refuses with a coded 409 when the role is unresolved. Counting
		// here as well would be a second answer free to disagree with the one that
		// acts, and "0 deleted" reads as success to a user whose Trash is untouched.
		return client.messageMove.emptyTrash(accountConfigId, accountId);
	},
};
