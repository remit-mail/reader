import type {
	CalendarObjectItem,
	ICalendarObjectRepository,
	PutCalendarObjectInput,
} from "@remit/data-ports";
import { deriveCalendarObjectId } from "@remit/data-ports/id";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { calendarObjectTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToCalendarObject(
	row: typeof calendarObjectTable.$inferSelect,
): CalendarObjectItem {
	return {
		calendarObjectId: row.calendarObjectId,
		calendarId: row.calendarId,
		resourceName: row.resourceName,
		icalUid: row.icalUid,
		icalData: row.icalData,
		etag: row.etag,
		sequence: row.sequence,
		syncSequence: row.syncSequence,
		summary: row.summary,
		dtStart: row.dtStart,
		dtEnd: row.dtEnd,
		allDay: row.allDay,
		zoneCertainty: row.zoneCertainty,
		status: row.status,
		transparency: row.transparency,
		hasRecurrence: row.hasRecurrence,
		expandedThrough: row.expandedThrough,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarObjectRepo implements ICalendarObjectRepository {
	constructor(private db: DB) {}

	async put(input: PutCalendarObjectInput): Promise<CalendarObjectItem> {
		const now = Date.now();
		const calendarObjectId = deriveCalendarObjectId(
			input.calendarId,
			input.resourceName,
		);
		const values = {
			...input,
			calendarObjectId,
			createdAt: now,
			updatedAt: now,
		};
		const [row] = await this.db
			.insert(calendarObjectTable)
			.values(values)
			.onConflictDoUpdate({
				target: calendarObjectTable.calendarObjectId,
				set: { ...input, updatedAt: now },
			})
			.returning();
		return rowToCalendarObject(row);
	}

	async get(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem> {
		const [row] = await this.db
			.select()
			.from(calendarObjectTable)
			.where(
				and(
					eq(calendarObjectTable.calendarId, calendarId),
					eq(calendarObjectTable.calendarObjectId, calendarObjectId),
				),
			);
		if (!row) {
			throw new NotFoundError(`Calendar object not found: ${calendarObjectId}`);
		}
		return rowToCalendarObject(row);
	}

	async find(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarObjectTable)
			.where(
				and(
					eq(calendarObjectTable.calendarId, calendarId),
					eq(calendarObjectTable.calendarObjectId, calendarObjectId),
				),
			);
		return row ? rowToCalendarObject(row) : null;
	}

	async delete(calendarId: string, calendarObjectId: string): Promise<void> {
		await this.db
			.delete(calendarObjectTable)
			.where(
				and(
					eq(calendarObjectTable.calendarId, calendarId),
					eq(calendarObjectTable.calendarObjectId, calendarObjectId),
				),
			);
	}

	/**
	 * A primary-key read, not a scan: `calendarObjectId` is derived from
	 * `(calendarId, resourceName)`, so the name a client PUT to computes
	 * straight to the row it wrote.
	 */
	async findByResourceName(
		calendarId: string,
		resourceName: string,
	): Promise<CalendarObjectItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarObjectTable)
			.where(
				eq(
					calendarObjectTable.calendarObjectId,
					deriveCalendarObjectId(calendarId, resourceName),
				),
			);
		return row ? rowToCalendarObject(row) : null;
	}

	async findByUid(
		calendarId: string,
		icalUid: string,
	): Promise<CalendarObjectItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarObjectTable)
			.where(
				and(
					eq(calendarObjectTable.calendarId, calendarId),
					eq(calendarObjectTable.icalUid, icalUid),
				),
			);
		return row ? rowToCalendarObject(row) : null;
	}

	async listByCalendar(calendarId: string): Promise<CalendarObjectItem[]> {
		const rows = await this.db
			.select()
			.from(calendarObjectTable)
			.where(eq(calendarObjectTable.calendarId, calendarId))
			.orderBy(asc(calendarObjectTable.resourceName));
		return rows.map(rowToCalendarObject);
	}

	async listChangedSince(
		calendarId: string,
		syncSequence: number,
	): Promise<CalendarObjectItem[]> {
		const rows = await this.db
			.select()
			.from(calendarObjectTable)
			.where(
				and(
					eq(calendarObjectTable.calendarId, calendarId),
					gt(calendarObjectTable.syncSequence, syncSequence),
				),
			)
			.orderBy(asc(calendarObjectTable.syncSequence));
		return rows.map(rowToCalendarObject);
	}
}
