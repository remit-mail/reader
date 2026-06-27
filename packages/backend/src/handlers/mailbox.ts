import type {
	MailboxItem,
	UpdateMailboxInput,
} from "@remit/remit-electrodb-service";
import type {
	MailboxResponse,
	RenameMailboxInput,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type {
	MailboxDetailOperationIds,
	MailboxOperationIds,
	OperationHandler,
	TrashOperationIds,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

/**
 * PATCH body fields that map directly to a DDB attribute with no IMAP
 * machinery: the mute flag plus the user overrides. Each follows the same
 * `null` → remove, value → set, absent/undefined → no-op semantics as
 * UpdateAddressFlagsInput.
 */
const MAILBOX_OVERRIDE_KEYS = [
	"muted",
	"displayNameOverride",
	"roleOverride",
] as const satisfies readonly (keyof RenameMailboxInput &
	keyof UpdateMailboxInput)[];

type MailboxOverrideKey = (typeof MAILBOX_OVERRIDE_KEYS)[number];

/**
 * Derive the direct DDB changes (mute flag + display-name/role overrides) from
 * a PATCH body.
 *
 * Returns `{ updates, remove }` where `updates` holds the fields to set and
 * `remove` lists the fields to delete. A field absent from the body (or
 * present as `undefined`) is a no-op; `null` removes it; any other value sets
 * it. None of these touch the rename/IMAP machinery.
 */
export const buildMailboxOverrideChanges = (
	body: RenameMailboxInput,
): { updates: UpdateMailboxInput; remove: MailboxOverrideKey[] } => {
	const updates: UpdateMailboxInput = {};
	const remove: MailboxOverrideKey[] = [];

	for (const key of MAILBOX_OVERRIDE_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
		const value = body[key];
		if (value === null) {
			remove.push(key);
			continue;
		}
		if (value === undefined) continue;
		// key/value originate from the same RenameMailboxInput field; the widened
		// record write is sound for this fixed key set.
		(updates as Record<MailboxOverrideKey, unknown>)[key] = value;
	}

	return { updates, remove };
};

/**
 * Minimal client surface needed to apply a mailbox PATCH. Structurally
 * satisfied by RemitClient; narrowed so tests can stub it.
 */
export interface MailboxPatchClient {
	mailbox: {
		get(mailboxId: string): Promise<MailboxItem>;
		update(
			mailboxId: string,
			input: UpdateMailboxInput,
			remove?: (keyof UpdateMailboxInput)[],
		): Promise<MailboxItem>;
	};
	mailboxQueue: {
		renameMailbox(
			mailboxId: string,
			newPath: string,
			accountId: string,
		): Promise<MailboxItem>;
	};
}

/**
 * Apply a mailbox PATCH body: mute changes first (direct DDB write, no IMAP
 * machinery), then rename — which triggers the IMAP rename machinery
 * (syncStatus/oldPath + MAILBOX_RENAME event) — only when `fullPath` is
 * present. A mute-only PATCH therefore never calls
 * `mailboxQueue.renameMailbox`.
 */
export const applyMailboxPatch = async (
	client: MailboxPatchClient,
	mailboxId: string,
	accountId: string,
	body: RenameMailboxInput,
): Promise<MailboxItem> => {
	const { fullPath } = body;

	// --- Direct DDB updates (mute flag + display-name/role overrides) ---
	// Delegated to buildMailboxOverrideChanges which follows the same
	// null→remove semantics as UpdateAddressFlagsInput. Applied before (and
	// independent of) any rename so an override-only PATCH never touches
	// syncStatus/oldPath.
	const { updates, remove } = buildMailboxOverrideChanges(body);
	if (Object.keys(updates).length > 0 || remove.length > 0) {
		await client.mailbox.update(
			mailboxId,
			updates,
			remove.length > 0 ? remove : undefined,
		);
	}

	// --- Rename (IMAP machinery) ---
	// Only triggered when fullPath is present.
	if (!fullPath) {
		return client.mailbox.get(mailboxId);
	}

	return client.mailboxQueue.renameMailbox(mailboxId, fullPath, accountId);
};

const toMailboxResponse = (mailbox: MailboxItem): MailboxResponse => ({
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
	muted: mailbox.muted,
	displayNameOverride: mailbox.displayNameOverride,
	roleOverride: mailbox.roleOverride,
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

		const client = getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const result = await client.mailbox.listByAccount(accountId, {
			continuationToken,
		});
		return {
			items: result.items.map(toMailboxResponse),
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

		const client = getClient();
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

		const client = getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const mailbox = await client.mailbox.get(mailboxId);
		return toMailboxResponse(mailbox);
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

		const client = getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const mailbox = await applyMailboxPatch(client, mailboxId, accountId, body);
		return toMailboxResponse(mailbox);
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

		const client = getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

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

		const client = getClient();

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
		await client.messageMove.emptyTrash(accountId);

		return { deletedCount };
	},
};
