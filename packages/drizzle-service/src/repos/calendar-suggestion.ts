import type {
	CalendarSuggestionItem,
	ICalendarSuggestionRepository,
	PutCalendarSuggestionInput,
	ResultList,
	SettleCalendarSuggestionInput,
} from "@remit/data-ports";
import { deriveCalendarSuggestionId } from "@remit/data-ports/id";
import { CalendarSuggestionState } from "@remit/domain-enums";
import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { decodeToken, resultList } from "../pagination.js";
import { calendarSuggestionTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToCalendarSuggestion(
	row: typeof calendarSuggestionTable.$inferSelect,
): CalendarSuggestionItem {
	return {
		suggestionId: row.suggestionId,
		accountConfigId: row.accountConfigId,
		messageId: row.messageId,
		bodyPartId: row.bodyPartId,
		icalUid: row.icalUid,
		sequence: row.sequence,
		method: row.method,
		source: row.source,
		state: row.state,
		summary: row.summary,
		dtStart: row.dtStart,
		dtEnd: row.dtEnd,
		allDay: row.allDay,
		location: row.location,
		organizer: row.organizer,
		zoneCertainty: row.zoneCertainty,
		icalData: row.icalData,
		acceptedCalendarObjectId: row.acceptedCalendarObjectId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class CalendarSuggestionRepo implements ICalendarSuggestionRepository {
	constructor(private db: DB) {}

	async put(
		input: PutCalendarSuggestionInput,
	): Promise<CalendarSuggestionItem> {
		const now = Date.now();
		const suggestionId = deriveCalendarSuggestionId(
			input.messageId,
			input.bodyPartId,
			input.icalUid,
		);
		const [row] = await this.db
			.insert(calendarSuggestionTable)
			.values({
				...input,
				suggestionId,
				state: CalendarSuggestionState.Pending,
				acceptedCalendarObjectId: "",
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					calendarSuggestionTable.accountConfigId,
					calendarSuggestionTable.suggestionId,
				],
				// `state` and `acceptedCalendarObjectId` are deliberately absent from
				// the update set: they carry what a person decided, and a producer
				// re-reading the message must not walk that back to Pending.
				set: { ...input, updatedAt: now },
			})
			.returning();
		return rowToCalendarSuggestion(row);
	}

	async get(
		accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem> {
		const [row] = await this.db
			.select()
			.from(calendarSuggestionTable)
			.where(
				and(
					eq(calendarSuggestionTable.accountConfigId, accountConfigId),
					eq(calendarSuggestionTable.suggestionId, suggestionId),
				),
			);
		if (!row) {
			throw new NotFoundError(`Calendar suggestion not found: ${suggestionId}`);
		}
		return rowToCalendarSuggestion(row);
	}

	async listByMessage(
		accountConfigId: string,
		messageId: string,
	): Promise<CalendarSuggestionItem[]> {
		const rows = await this.db
			.select()
			.from(calendarSuggestionTable)
			.where(
				and(
					eq(calendarSuggestionTable.accountConfigId, accountConfigId),
					eq(calendarSuggestionTable.messageId, messageId),
				),
			)
			.orderBy(
				asc(calendarSuggestionTable.createdAt),
				asc(calendarSuggestionTable.suggestionId),
			);
		return rows.map(rowToCalendarSuggestion);
	}

	/**
	 * Newest first, paged on a keyset over `(createdAt, suggestionId)` — the
	 * exact trailing members of the `byState` index's sort key, read backwards.
	 * The order is the index's own, never a sort applied on top of it.
	 */
	async listByState(
		accountConfigId: string,
		state: CalendarSuggestionItem["state"],
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<CalendarSuggestionItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					suggestionId: cursor.suggestionId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(calendarSuggestionTable)
			.where(
				and(
					eq(calendarSuggestionTable.accountConfigId, accountConfigId),
					eq(calendarSuggestionTable.state, state),
					after
						? or(
								lt(calendarSuggestionTable.createdAt, after.createdAt),
								and(
									eq(calendarSuggestionTable.createdAt, after.createdAt),
									lt(calendarSuggestionTable.suggestionId, after.suggestionId),
								),
							)
						: undefined,
				),
			)
			.orderBy(
				desc(calendarSuggestionTable.createdAt),
				desc(calendarSuggestionTable.suggestionId),
			)
			.limit(limit);

		const items = rows.map(rowToCalendarSuggestion);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			lastItem
				? {
						createdAt: lastItem.createdAt,
						suggestionId: lastItem.suggestionId,
					}
				: undefined,
		);
	}

	async settle(
		accountConfigId: string,
		suggestionId: string,
		input: SettleCalendarSuggestionInput,
	): Promise<CalendarSuggestionItem> {
		const [row] = await this.db
			.update(calendarSuggestionTable)
			.set({ ...input, updatedAt: Date.now() })
			.where(
				and(
					eq(calendarSuggestionTable.accountConfigId, accountConfigId),
					eq(calendarSuggestionTable.suggestionId, suggestionId),
				),
			)
			.returning();
		if (!row) {
			throw new NotFoundError(`Calendar suggestion not found: ${suggestionId}`);
		}
		return rowToCalendarSuggestion(row);
	}

	async supersedeIfPending(
		accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem | null> {
		const [row] = await this.db
			.update(calendarSuggestionTable)
			.set({
				state: CalendarSuggestionState.Superseded,
				acceptedCalendarObjectId: "",
				updatedAt: Date.now(),
			})
			.where(
				and(
					eq(calendarSuggestionTable.accountConfigId, accountConfigId),
					eq(calendarSuggestionTable.suggestionId, suggestionId),
					// The condition is the point: a card the user answered between
					// the producer's read and this write must keep their answer.
					eq(calendarSuggestionTable.state, CalendarSuggestionState.Pending),
				),
			)
			.returning();
		return row ? rowToCalendarSuggestion(row) : null;
	}
}
