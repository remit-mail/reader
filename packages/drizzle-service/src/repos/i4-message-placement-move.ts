import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { messagePlacementMoveTable } from "../schema/i4-message-placement-move.js";

type DB = NodePgDatabase<Record<string, unknown>>;

export type MessagePlacementMoveState =
	| "pending"
	| "queued"
	| "processing"
	| "processed";

export interface MessagePlacementMoveItem {
	messageId: string;
	accountId: string;
	accountConfigId: string;
	sourceMailboxId: string;
	destinationMailboxId: string;
	state: MessagePlacementMoveState;
	createdAt: number;
	updatedAt: number;
}

export type PutMessagePlacementMoveInput = Omit<
	MessagePlacementMoveItem,
	"state" | "createdAt" | "updatedAt"
>;

const DEFAULT_STATE: MessagePlacementMoveState = "pending";

function rowToItem(
	row: typeof messagePlacementMoveTable.$inferSelect,
): MessagePlacementMoveItem {
	return {
		messageId: row.messageId,
		accountId: row.accountId,
		accountConfigId: row.accountConfigId,
		sourceMailboxId: row.sourceMailboxId,
		destinationMailboxId: row.destinationMailboxId,
		state: row.state,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Postgres counterpart to `MessagePlacementMoveService` (remit-electrodb-service).
 * Same public shape (`put`/`find`/`delete`/`listByAccountId`) so both backends
 * satisfy the same structural contract for read-time count prediction
 * (`mailbox.ts`'s `loadPendingMoves`, epic #1281 invariant 4).
 *
 * `messageId` is the marker's primary key — always our internal message id,
 * NEVER a fresh generated one. The generated `messagePlacementMoveTable`
 * schema defaults `messageId` via `$defaultFn` (matching every other
 * @key-scalar column the emitter sees) — that default must never fire here,
 * so every insert below supplies `messageId` explicitly.
 */
export class MessagePlacementMoveRepo {
	constructor(private db: DB) {}

	put = async (
		input: PutMessagePlacementMoveInput,
	): Promise<MessagePlacementMoveItem> => {
		const now = Date.now();
		// A fresh put ALWAYS resets state to `pending` (the field's default) —
		// a new placement decision starts a new lifecycle regardless of
		// whatever state the row it replaces was in.
		const [row] = await this.db
			.insert(messagePlacementMoveTable)
			.values({
				...input,
				state: DEFAULT_STATE,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: messagePlacementMoveTable.messageId,
				set: {
					accountId: input.accountId,
					accountConfigId: input.accountConfigId,
					sourceMailboxId: input.sourceMailboxId,
					destinationMailboxId: input.destinationMailboxId,
					state: DEFAULT_STATE,
					updatedAt: now,
				},
			})
			.returning();
		if (!row) {
			throw new Error(
				`Failed to upsert MessagePlacementMove: ${input.messageId}`,
			);
		}
		return rowToItem(row);
	};

	find = async (
		messageId: string,
	): Promise<MessagePlacementMoveItem | null> => {
		const [row] = await this.db
			.select()
			.from(messagePlacementMoveTable)
			.where(eq(messagePlacementMoveTable.messageId, messageId));
		return row ? rowToItem(row) : null;
	};

	/**
	 * Advance the marker's state engine. Never touches any other field — a
	 * state transition is not a new decision, so the mailbox ids must not
	 * change here (a genuinely new decision goes through `put`, which fully
	 * replaces the row).
	 */
	updateState = async (
		messageId: string,
		state: MessagePlacementMoveState,
	): Promise<MessagePlacementMoveItem> => {
		const [row] = await this.db
			.update(messagePlacementMoveTable)
			.set({ state, updatedAt: Date.now() })
			.where(eq(messagePlacementMoveTable.messageId, messageId))
			.returning();
		if (!row) {
			throw new Error(
				`Cannot update state on a MessagePlacementMove that does not exist: ${messageId}`,
			);
		}
		return rowToItem(row);
	};

	delete = async (messageId: string): Promise<void> => {
		await this.db
			.delete(messagePlacementMoveTable)
			.where(eq(messagePlacementMoveTable.messageId, messageId));
	};

	listByAccountId = async (
		accountId: string,
	): Promise<MessagePlacementMoveItem[]> => {
		const rows = await this.db
			.select()
			.from(messagePlacementMoveTable)
			.where(eq(messagePlacementMoveTable.accountId, accountId));
		return rows.map(rowToItem);
	};
}
