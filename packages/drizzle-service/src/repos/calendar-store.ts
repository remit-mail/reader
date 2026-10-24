import type {
	CalendarRepositories,
	CalendarWrite,
	ICalendarStore,
} from "@remit/data-ports";
import { deriveCalendarObjectId } from "@remit/data-ports/id";
import { and, eq, exists, not, sql } from "drizzle-orm";
import { runBatch, type SqliteBatchItem } from "../batch.js";
import type { Db } from "../db.js";
import {
	calendarEventIndexTable,
	calendarFeedTokenTable,
	calendarObjectTable,
	calendarSuggestionTable,
	calendarTable,
} from "../schema.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";
import { CalendarFeedTokenRepo } from "./calendar-feed-token.js";
import { CalendarObjectRepo } from "./calendar-object.js";
import { CalendarSuggestionRepo } from "./calendar-suggestion.js";

type DB = Db<Record<string, unknown>>;

export class DrizzleCalendarStore implements ICalendarStore {
	readonly repos: CalendarRepositories;

	constructor(private db: DB) {
		this.repos = {
			calendarCollection: new CalendarCollectionRepo(db),
			calendarObject: new CalendarObjectRepo(db),
			calendarEventIndex: new CalendarEventIndexRepo(db),
			calendarSuggestion: new CalendarSuggestionRepo(db),
			calendarFeedToken: new CalendarFeedTokenRepo(db),
		};
	}

	async commit(writes: readonly CalendarWrite[]): Promise<void> {
		await runBatch(
			this.db,
			writes.flatMap((write) => this.statements(write)),
		);
	}

	private collection(accountConfigId: string, calendarId: string) {
		return and(
			eq(calendarTable.accountConfigId, accountConfigId),
			eq(calendarTable.calendarId, calendarId),
		);
	}

	private bump(accountConfigId: string, calendarId: string): SqliteBatchItem {
		return this.db
			.update(calendarTable)
			.set({
				syncSequence: sql`${calendarTable.syncSequence} + 1`,
				updatedAt: Date.now(),
			})
			.where(this.collection(accountConfigId, calendarId));
	}

	private clearOccurrences(
		calendarId: string,
		calendarObjectId: string,
	): SqliteBatchItem {
		return this.db
			.delete(calendarEventIndexTable)
			.where(
				and(
					eq(calendarEventIndexTable.calendarId, calendarId),
					eq(calendarEventIndexTable.calendarObjectId, calendarObjectId),
				),
			);
	}

	private statements(write: CalendarWrite): SqliteBatchItem[] {
		const now = Date.now();
		switch (write.kind) {
			case "PutObject":
			case "ReprojectObject": {
				const { calendarId, resourceName } = write.object;
				const calendarObjectId = deriveCalendarObjectId(
					calendarId,
					resourceName,
				);
				// The sequence the bump just wrote, read inside the batch. A
				// collection that is gone yields NULL, which the NOT NULL column
				// refuses, so the whole batch fails rather than storing an orphan.
				const syncSequence = sql<number>`(${this.db
					.select({ syncSequence: calendarTable.syncSequence })
					.from(calendarTable)
					.where(this.collection(write.accountConfigId, calendarId))})`;
				const object =
					write.kind === "PutObject"
						? this.db
								.insert(calendarObjectTable)
								.values({
									...write.object,
									calendarObjectId,
									syncSequence,
									createdAt: now,
									updatedAt: now,
								})
								.onConflictDoUpdate({
									target: calendarObjectTable.calendarObjectId,
									set: { ...write.object, syncSequence, updatedAt: now },
								})
						: this.db
								.update(calendarObjectTable)
								.set({ ...write.object, syncSequence, updatedAt: now })
								.where(
									eq(calendarObjectTable.calendarObjectId, calendarObjectId),
								);
				const items: SqliteBatchItem[] = [
					this.bump(write.accountConfigId, calendarId),
					object,
					this.clearOccurrences(calendarId, calendarObjectId),
				];
				if (write.occurrences.length === 0) return items;
				const occurrences = this.db.insert(calendarEventIndexTable).values(
					write.occurrences.map((occurrence) => ({
						...occurrence,
						calendarId,
						calendarObjectId,
						createdAt: now,
						updatedAt: now,
					})),
				);
				if (write.kind === "PutObject") return [...items, occurrences];
				// A resource deleted since it was read wrote nothing above, so the
				// occurrences written for it go again in the same batch.
				return [
					...items,
					occurrences,
					this.db
						.delete(calendarEventIndexTable)
						.where(
							and(
								eq(calendarEventIndexTable.calendarObjectId, calendarObjectId),
								not(
									exists(
										this.db
											.select({ id: calendarObjectTable.calendarObjectId })
											.from(calendarObjectTable)
											.where(
												eq(
													calendarObjectTable.calendarObjectId,
													calendarObjectId,
												),
											),
									),
								),
							),
						),
				];
			}
			case "DeleteObject":
				return [
					this.clearOccurrences(write.calendarId, write.calendarObjectId),
					this.db
						.delete(calendarObjectTable)
						.where(
							and(
								eq(calendarObjectTable.calendarId, write.calendarId),
								eq(
									calendarObjectTable.calendarObjectId,
									write.calendarObjectId,
								),
							),
						),
					this.bump(write.accountConfigId, write.calendarId),
				];
			case "SettleSuggestion":
				return [
					this.db
						.update(calendarSuggestionTable)
						.set({ ...write.settle, updatedAt: now })
						.where(
							and(
								eq(
									calendarSuggestionTable.accountConfigId,
									write.accountConfigId,
								),
								eq(calendarSuggestionTable.suggestionId, write.suggestionId),
							),
						),
				];
			case "UpdateCollection":
				return [
					this.db
						.update(calendarTable)
						.set({ ...write.patch, updatedAt: now })
						.where(this.collection(write.accountConfigId, write.calendarId)),
				];
			case "DeleteCollection":
				return [
					this.db
						.delete(calendarEventIndexTable)
						.where(eq(calendarEventIndexTable.calendarId, write.calendarId)),
					this.db
						.delete(calendarObjectTable)
						.where(eq(calendarObjectTable.calendarId, write.calendarId)),
					this.db
						.delete(calendarFeedTokenTable)
						.where(
							and(
								eq(
									calendarFeedTokenTable.accountConfigId,
									write.accountConfigId,
								),
								eq(calendarFeedTokenTable.calendarId, write.calendarId),
							),
						),
					this.db
						.delete(calendarTable)
						.where(this.collection(write.accountConfigId, write.calendarId)),
				];
		}
	}
}
