import type {
	MessageFlagPushItem,
	PutMessageFlagPushInput,
} from "@remit/data-ports";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { messageFlagPushTable } from "../schema/i4-message-flag-push.js";

type DB = Db<Record<string, unknown>>;

const DEFAULT_STATE: MessageFlagPushItem["state"] = "pending";

function rowToItem(
	row: typeof messageFlagPushTable.$inferSelect,
): MessageFlagPushItem {
	return {
		messageId: row.messageId,
		flagName: row.flagName,
		accountId: row.accountId,
		accountConfigId: row.accountConfigId,
		mailboxId: row.mailboxId,
		operation: row.operation,
		state: row.state,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Relational counterpart to `MessageFlagPushService` (remit-electrodb-service).
 * Same public shape (`put`/`find`/`updateState`/`delete`/`listByAccountId`/
 * `listByMailboxId`) so both backends satisfy the same structural contract
 * for read-time unseenCount prediction (issue #1273, epic #1281 invariant 4)
 * and the account-worker cascade delete.
 *
 * Keyed by (`messageId`, `flagName`) — a message can carry an independent
 * pending read-state marker and pending star marker at once (epic FAQ: "a
 * flag flip replaces a pending flag flip", scoped per field).
 */
export class MessageFlagPushRepo {
	constructor(private db: DB) {}

	put = async (
		input: PutMessageFlagPushInput,
	): Promise<MessageFlagPushItem> => {
		const now = Date.now();
		// A fresh put ALWAYS resets state to `pending` AND createdAt to now — a
		// new flip decision starts a genuinely new lifecycle regardless of
		// whatever state (or age) the row it replaces was in. The conflict path
		// must reset createdAt explicitly: onConflictDoUpdate only touches the
		// columns named in `set`, so an omission here would let a replacing put
		// silently inherit the original row's createdAt (its age then misreads
		// as a stuck deferred marker elsewhere — see flag-push.ts's defer-max
		// check, which measures a marker's age off exactly this field).
		const [row] = await this.db
			.insert(messageFlagPushTable)
			.values({
				...input,
				state: DEFAULT_STATE,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [messageFlagPushTable.messageId, messageFlagPushTable.flagName],
				set: {
					accountId: input.accountId,
					accountConfigId: input.accountConfigId,
					mailboxId: input.mailboxId,
					operation: input.operation,
					state: DEFAULT_STATE,
					createdAt: now,
					updatedAt: now,
				},
			})
			.returning();
		if (!row) {
			throw new Error(
				`Failed to upsert MessageFlagPush: ${input.messageId}/${input.flagName}`,
			);
		}
		return rowToItem(row);
	};

	find = async (
		messageId: string,
		flagName: string,
	): Promise<MessageFlagPushItem | null> => {
		const [row] = await this.db
			.select()
			.from(messageFlagPushTable)
			.where(
				and(
					eq(messageFlagPushTable.messageId, messageId),
					eq(messageFlagPushTable.flagName, flagName),
				),
			);
		return row ? rowToItem(row) : null;
	};

	/**
	 * Advance the marker's state engine. Never touches any other field — a
	 * state transition is not a new decision, so `operation`/`mailboxId` must
	 * not change here (a genuinely new decision goes through `put`, which
	 * fully replaces the row).
	 */
	updateState = async (
		messageId: string,
		flagName: string,
		state: MessageFlagPushItem["state"],
	): Promise<MessageFlagPushItem> => {
		const [row] = await this.db
			.update(messageFlagPushTable)
			.set({ state, updatedAt: Date.now() })
			.where(
				and(
					eq(messageFlagPushTable.messageId, messageId),
					eq(messageFlagPushTable.flagName, flagName),
				),
			)
			.returning();
		if (!row) {
			throw new Error(
				`Cannot update state on a MessageFlagPush that does not exist: ${messageId}/${flagName}`,
			);
		}
		return rowToItem(row);
	};

	delete = async (messageId: string, flagName: string): Promise<void> => {
		await this.db
			.delete(messageFlagPushTable)
			.where(
				and(
					eq(messageFlagPushTable.messageId, messageId),
					eq(messageFlagPushTable.flagName, flagName),
				),
			);
	};

	listByAccountId = async (
		accountId: string,
	): Promise<MessageFlagPushItem[]> => {
		const rows = await this.db
			.select()
			.from(messageFlagPushTable)
			.where(eq(messageFlagPushTable.accountId, accountId));
		return rows.map(rowToItem);
	};

	listByMailboxId = async (
		mailboxId: string,
	): Promise<MessageFlagPushItem[]> => {
		const rows = await this.db
			.select()
			.from(messageFlagPushTable)
			.where(eq(messageFlagPushTable.mailboxId, mailboxId));
		return rows.map(rowToItem);
	};
}
