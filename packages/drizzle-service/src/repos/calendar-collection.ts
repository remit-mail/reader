import type {
	CalendarCollectionItem,
	CreateCalendarCollectionInput,
	ICalendarCollectionRepository,
	UpdateCalendarCollectionInput,
} from "@remit/data-ports";
import {
	deriveCalendarId,
	normalizeCalendarUrlSegment,
} from "@remit/data-ports/id";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { calendarTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToCalendar(
	row: typeof calendarTable.$inferSelect,
): CalendarCollectionItem {
	return {
		calendarId: row.calendarId,
		accountConfigId: row.accountConfigId,
		urlSegment: row.urlSegment,
		displayName: row.displayName,
		color: row.color,
		componentSet: row.componentSet,
		source: row.source,
		timezone: row.timezone,
		syncSequence: row.syncSequence,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarCollectionRepo implements ICalendarCollectionRepository {
	constructor(private db: DB) {}

	/**
	 * Provisioning is idempotent by construction: `calendarId` is derived, so a
	 * second create of the same `(accountConfigId, urlSegment)` collides with
	 * the row it already wrote. The conflict keeps the stored row rather than
	 * overwriting it — two concurrent first uses of an account must not have the
	 * loser reset a collection the winner has already had writes against.
	 */
	async create(
		input: CreateCalendarCollectionInput,
	): Promise<CalendarCollectionItem> {
		const now = Date.now();
		const urlSegment = normalizeCalendarUrlSegment(input.urlSegment);
		const calendarId = deriveCalendarId(input.accountConfigId, urlSegment);
		const [row] = await this.db
			.insert(calendarTable)
			.values({
				calendarId,
				accountConfigId: input.accountConfigId,
				urlSegment,
				displayName: input.displayName,
				color: input.color ?? "Cal1",
				componentSet: input.componentSet ?? "VeventOnly",
				source: input.source ?? "UserCreated",
				timezone: input.timezone ?? "",
				syncSequence: 0,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: calendarTable.calendarId,
				set: { updatedAt: now },
			})
			.returning();
		return rowToCalendar(row);
	}

	async get(
		accountConfigId: string,
		calendarId: string,
	): Promise<CalendarCollectionItem> {
		const [row] = await this.db
			.select()
			.from(calendarTable)
			.where(
				and(
					eq(calendarTable.accountConfigId, accountConfigId),
					eq(calendarTable.calendarId, calendarId),
				),
			);
		if (!row) {
			throw new NotFoundError(`Calendar not found: ${calendarId}`);
		}
		return rowToCalendar(row);
	}

	async update(
		accountConfigId: string,
		calendarId: string,
		input: UpdateCalendarCollectionInput,
	): Promise<CalendarCollectionItem> {
		const [row] = await this.db
			.update(calendarTable)
			.set({ ...input, updatedAt: Date.now() })
			.where(
				and(
					eq(calendarTable.accountConfigId, accountConfigId),
					eq(calendarTable.calendarId, calendarId),
				),
			)
			.returning();
		if (!row) {
			throw new NotFoundError(`Calendar not found: ${calendarId}`);
		}
		return rowToCalendar(row);
	}

	async delete(accountConfigId: string, calendarId: string): Promise<void> {
		await this.db
			.delete(calendarTable)
			.where(
				and(
					eq(calendarTable.accountConfigId, accountConfigId),
					eq(calendarTable.calendarId, calendarId),
				),
			);
	}

	async listByAccountConfig(
		accountConfigId: string,
	): Promise<CalendarCollectionItem[]> {
		const rows = await this.db
			.select()
			.from(calendarTable)
			.where(eq(calendarTable.accountConfigId, accountConfigId))
			.orderBy(asc(calendarTable.urlSegment));
		return rows.map(rowToCalendar);
	}

	async findByUrlSegment(
		accountConfigId: string,
		urlSegment: string,
	): Promise<CalendarCollectionItem | null> {
		const [row] = await this.db
			.select()
			.from(calendarTable)
			.where(
				and(
					eq(calendarTable.accountConfigId, accountConfigId),
					eq(calendarTable.urlSegment, normalizeCalendarUrlSegment(urlSegment)),
				),
			);
		return row ? rowToCalendar(row) : null;
	}

	/**
	 * One statement, so two writers can never read the same value and stamp it
	 * on two different objects — which would hide one of them from every later
	 * sync report that pages by the sequence.
	 */
	async bumpSyncSequence(
		accountConfigId: string,
		calendarId: string,
	): Promise<number> {
		const [row] = await this.db
			.update(calendarTable)
			.set({
				syncSequence: sql`${calendarTable.syncSequence} + 1`,
				updatedAt: Date.now(),
			})
			.where(
				and(
					eq(calendarTable.accountConfigId, accountConfigId),
					eq(calendarTable.calendarId, calendarId),
				),
			)
			.returning();
		if (!row) {
			throw new NotFoundError(`Calendar not found: ${calendarId}`);
		}
		return row.syncSequence;
	}
}
