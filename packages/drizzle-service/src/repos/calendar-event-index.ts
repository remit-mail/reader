import type {
	CalendarEventIndexItem,
	CalendarOccurrenceInput,
	ICalendarEventIndexRepository,
} from "@remit/data-ports";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { SqliteBatchItem, WriteBatch } from "../batch.js";
import { chunkRows } from "../bound-parameters.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { calendarEventIndexTable } from "../schema.js";

type DB = RepositoryDb<Record<string, unknown>>;

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
		summary: row.summary,
		status: row.status,
		transparency: row.transparency,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarEventIndexRepo implements ICalendarEventIndexRepository {
	private readonly db: DB;
	private readonly batch: WriteBatch;
	private readonly maxBoundParameters: number;

	constructor(store: SqliteStore<Record<string, unknown>>) {
		this.db = store.db;
		this.batch = store.batch;
		this.maxBoundParameters = store.maxBoundParameters;
	}

	async replaceForObject(
		calendarId: string,
		calendarObjectId: string,
		occurrences: CalendarOccurrenceInput[],
	): Promise<void> {
		const now = Date.now();
		const rows = occurrences.map((occurrence) => ({
			calendarId,
			calendarObjectId,
			recurrenceId: occurrence.recurrenceId,
			startAt: occurrence.startAt,
			endAt: occurrence.endAt,
			allDay: occurrence.allDay,
			summary: occurrence.summary,
			status: occurrence.status,
			transparency: occurrence.transparency,
			createdAt: now,
			updatedAt: now,
		}));
		const inserts: SqliteBatchItem[] = chunkRows(
			calendarEventIndexTable,
			rows,
			this.maxBoundParameters,
		).map((slice) => this.db.insert(calendarEventIndexTable).values(slice));
		await this.batch([this.clear(calendarId, calendarObjectId), ...inserts]);
	}

	async deleteForObject(
		calendarId: string,
		calendarObjectId: string,
	): Promise<void> {
		await this.clear(calendarId, calendarObjectId);
	}

	private clear(calendarId: string, calendarObjectId: string) {
		return this.db
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
