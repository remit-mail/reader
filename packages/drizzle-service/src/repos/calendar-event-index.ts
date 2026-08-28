import type {
	CalendarEventIndexItem,
	CalendarOccurrenceInput,
	ICalendarEventIndexRepository,
} from "@remit/data-ports";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db.js";
import { calendarEventIndexTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToOccurrence(
	row: typeof calendarEventIndexTable.$inferSelect,
): CalendarEventIndexItem {
	return {
		calendarId: row.calendarId,
		calendarObjectId: row.calendarObjectId,
		recurrenceId: row.recurrenceId,
		startAt: row.startAt,
		endAt: row.endAt,
		allDay: row.allDay,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarEventIndexRepo implements ICalendarEventIndexRepository {
	constructor(private db: DB) {}

	async replaceForObject(
		calendarId: string,
		calendarObjectId: string,
		occurrences: CalendarOccurrenceInput[],
	): Promise<void> {
		await this.deleteForObject(calendarId, calendarObjectId);
		if (occurrences.length === 0) return;

		const now = Date.now();
		await this.db.insert(calendarEventIndexTable).values(
			occurrences.map((occurrence) => ({
				calendarId,
				calendarObjectId,
				recurrenceId: occurrence.recurrenceId,
				startAt: occurrence.startAt,
				endAt: occurrence.endAt,
				allDay: occurrence.allDay,
				createdAt: now,
				updatedAt: now,
			})),
		);
	}

	async deleteForObject(
		calendarId: string,
		calendarObjectId: string,
	): Promise<void> {
		await this.db
			.delete(calendarEventIndexTable)
			.where(
				and(
					eq(calendarEventIndexTable.calendarId, calendarId),
					eq(calendarEventIndexTable.calendarObjectId, calendarObjectId),
				),
			);
	}

	async listForObject(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarEventIndexItem[]> {
		const rows = await this.db
			.select()
			.from(calendarEventIndexTable)
			.where(
				and(
					eq(calendarEventIndexTable.calendarId, calendarId),
					eq(calendarEventIndexTable.calendarObjectId, calendarObjectId),
				),
			)
			.orderBy(asc(calendarEventIndexTable.startAt));
		return rows.map(rowToOccurrence);
	}

	async listByStartRange(
		calendarId: string,
		startAt: string,
		endAt: string,
	): Promise<CalendarEventIndexItem[]> {
		const rows = await this.db
			.select()
			.from(calendarEventIndexTable)
			.where(
				and(
					eq(calendarEventIndexTable.calendarId, calendarId),
					gte(calendarEventIndexTable.startAt, startAt),
					lt(calendarEventIndexTable.startAt, endAt),
				),
			)
			.orderBy(asc(calendarEventIndexTable.startAt));
		return rows.map(rowToOccurrence);
	}
}
