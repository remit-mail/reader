import type {
	CalendarTaskItem,
	ICalendarTaskRepository,
	PutCalendarTaskInput,
} from "@remit/data-ports";
import { deriveCalendarTaskId } from "@remit/data-ports/id";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { calendarTaskTable } from "../schema.js";

type DB = RepositoryDb;

const rowToTask = (
	row: typeof calendarTaskTable.$inferSelect,
): CalendarTaskItem => ({
	calendarTaskId: row.calendarTaskId,
	calendarId: row.calendarId,
	resourceName: row.resourceName,
	icalUid: row.icalUid,
	icalData: row.icalData,
	etag: row.etag,
	summary: row.summary,
	description: row.description,
	due: row.due,
	dueAt: row.dueAt,
	allDay: row.allDay,
	completed: row.completed,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

export class CalendarTaskRepo implements ICalendarTaskRepository {
	constructor(private db: DB) {}

	async put(input: PutCalendarTaskInput): Promise<CalendarTaskItem> {
		const now = Date.now();
		const calendarTaskId = deriveCalendarTaskId(
			input.calendarId,
			input.resourceName,
		);
		const [row] = await this.db
			.insert(calendarTaskTable)
			.values({ ...input, calendarTaskId, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: calendarTaskTable.calendarTaskId,
				set: { ...input, updatedAt: now },
			})
			.returning();
		return rowToTask(row);
	}

	async find(
		calendarId: string,
		calendarTaskId: string,
	): Promise<CalendarTaskItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarTaskTable)
			.where(
				and(
					eq(calendarTaskTable.calendarId, calendarId),
					eq(calendarTaskTable.calendarTaskId, calendarTaskId),
				),
			);
		return row ? rowToTask(row) : null;
	}

	async delete(calendarId: string, calendarTaskId: string): Promise<void> {
		await this.db
			.delete(calendarTaskTable)
			.where(
				and(
					eq(calendarTaskTable.calendarId, calendarId),
					eq(calendarTaskTable.calendarTaskId, calendarTaskId),
				),
			);
	}

	async listByDueRange(
		calendarId: string,
		fromAt: string,
		toAt: string,
	): Promise<CalendarTaskItem[]> {
		const rows = await this.db
			.select()
			.from(calendarTaskTable)
			.where(
				and(
					eq(calendarTaskTable.calendarId, calendarId),
					gte(calendarTaskTable.dueAt, fromAt),
					lt(calendarTaskTable.dueAt, toAt),
				),
			)
			.orderBy(asc(calendarTaskTable.dueAt));
		return rows.map(rowToTask);
	}

	async deleteByCalendar(calendarId: string): Promise<void> {
		await this.db
			.delete(calendarTaskTable)
			.where(eq(calendarTaskTable.calendarId, calendarId));
	}
}
