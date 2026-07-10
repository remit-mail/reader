import type { IAccountSettingRepository } from "@remit/data-ports";
import {
	ForbiddenError,
	type MailboxItem,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import type {
	MailboxResponse,
	RenameMailboxInput,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { fireAndForget } from "../service/fire-and-forget.js";
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

/**
 * The mute flag and the display-name/role overrides are user preferences that
 * live in per-mailbox AccountSetting rows (RFC 032), not on the Mailbox entity.
 * Pick only those keys from a PATCH body: each follows the same `null` → remove,
 * value → set, absent/undefined → no-op semantics as UpdateAddressFlagsInput.
 */
export const pickMailboxOverrideChanges = (
	body: RenameMailboxInput,
): {
	displayNameOverride?: string | null;
	roleOverride?: string | null;
	muted?: RenameMailboxInput["muted"];
} => {
	const changes: {
		displayNameOverride?: string | null;
		roleOverride?: string | null;
		muted?: RenameMailboxInput["muted"];
	} = {};
	if (Object.hasOwn(body, "displayNameOverride")) {
		changes.displayNameOverride = body.displayNameOverride;
	}
	if (Object.hasOwn(body, "roleOverride")) {
		changes.roleOverride = body.roleOverride;
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
	};
	mailboxQueue: {
		renameMailbox(
			mailboxId: string,
			newPath: string,
			accountId: string,
		): Promise<MailboxItem>;
	};
	accountSetting: Pick<IAccountSettingRepository, "upsert" | "delete">;
}

/**
 * Apply a mailbox PATCH body: override changes first (mute flag + display-name/
 * role overrides — written to per-mailbox AccountSetting rows, no IMAP
 * machinery), then rename — which triggers the IMAP rename machinery
 * (syncStatus/oldPath + MAILBOX_RENAME event) — only when `fullPath` is
 * present. An override-only PATCH therefore never calls
 * `mailboxQueue.renameMailbox`.
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
	// independent of) any rename so an override-only PATCH never touches
	// syncStatus/oldPath.
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
	muted: overrides.muted,
	displayNameOverride: overrides.displayNameOverride,
	roleOverride: overrides.roleOverride,
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

		// Mailbox listing is the account view the web client polls while a
		// mailbox is open (useStaleAccountSync's invalidation target) — the
		// cheapest available proxy for "this account is online" (#1247). The
		// write is throttled server-side (bumpActivity), so firing it on every
		// read is safe; it must never fail or slow down this read.
		void fireAndForget(() => client.account.bumpActivity(accountId), {
			source: "account_activity_bump",
			message: "Failed to record account activity (best-effort)",
			ids: { accountId },
			alert: "account_activity_bump_failed",
		});

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
		return {
			items: result.items.map((mailbox) =>
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
				highestModseq: 0,
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
		return toMailboxResponse(mailbox, overrides);
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

		const trashMailbox =
			await client.mailboxSpecialUse.findTrashMailbox(accountId);

		if (!trashMailbox) {
			return { deletedCount: 0 };
		}

		// Get count of messages in trash before emptying
		const messages = await client.message.listAllByMailbox(
			trashMailbox.mailboxId,
		);
		const deletedCount = messages.length;

		// MessageMoveService handles: Message status updates + SQS event
		await client.messageMove.emptyTrash(accountConfigId, accountId);

		return { deletedCount };
	},
};
