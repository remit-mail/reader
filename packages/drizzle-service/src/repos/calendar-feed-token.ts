import type {
	CalendarFeedTokenItem,
	ICalendarFeedTokenRepository,
	PutCalendarFeedTokenInput,
} from "@remit/data-ports";
import { deriveCalendarFeedTokenId } from "@remit/data-ports/id";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { calendarFeedTokenTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToFeedToken(
	row: typeof calendarFeedTokenTable.$inferSelect,
): CalendarFeedTokenItem {
	return {
		feedTokenId: row.feedTokenId,
		accountConfigId: row.accountConfigId,
		calendarId: row.calendarId,
		tokenHash: row.tokenHash,
		createdAt: row.createdAt,
		rotatedAt: row.rotatedAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarFeedTokenRepo implements ICalendarFeedTokenRepository {
	constructor(private db: DB) {}

	/**
	 * One statement, so a rotation can never be observed as two live addresses.
	 * The conflict target is the derived primary key, which is what makes "one
	 * active token per calendar" a property of the schema rather than of this
	 * method: `createdAt` is left where it was and `rotatedAt` takes the clock,
	 * so the row itself says whether this address is the calendar's first.
	 */
	async put(input: PutCalendarFeedTokenInput): Promise<CalendarFeedTokenItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(calendarFeedTokenTable)
			.values({
				feedTokenId: deriveCalendarFeedTokenId(input.calendarId),
				accountConfigId: input.accountConfigId,
				calendarId: input.calendarId,
				tokenHash: input.tokenHash,
				createdAt: now,
				rotatedAt: 0,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					calendarFeedTokenTable.accountConfigId,
					calendarFeedTokenTable.feedTokenId,
				],
				set: { tokenHash: input.tokenHash, rotatedAt: now, updatedAt: now },
			})
			.returning();
		return rowToFeedToken(row);
	}

	async findByCalendar(
		accountConfigId: string,
		calendarId: string,
	): Promise<CalendarFeedTokenItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarFeedTokenTable)
			.where(
				and(
					eq(calendarFeedTokenTable.accountConfigId, accountConfigId),
					eq(calendarFeedTokenTable.calendarId, calendarId),
				),
			);
		return row ? rowToFeedToken(row) : null;
	}

	async findByTokenHash(
		tokenHash: string,
	): Promise<CalendarFeedTokenItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarFeedTokenTable)
			.where(eq(calendarFeedTokenTable.tokenHash, tokenHash));
		return row ? rowToFeedToken(row) : null;
	}

	async delete(accountConfigId: string, calendarId: string): Promise<void> {
		await this.db
			.delete(calendarFeedTokenTable)
			.where(
				and(
					eq(calendarFeedTokenTable.accountConfigId, accountConfigId),
					eq(calendarFeedTokenTable.calendarId, calendarId),
				),
			);
	}
}
