import type {
	CalendarCommitReport,
	CalendarRepositories,
	CalendarWrite,
	ICalendarStore,
	ICalendarSuggestionRepository,
	SettleCalendarSuggestionWrite,
} from "@remit/data-ports";
import { deriveCalendarObjectId } from "@remit/data-ports/id";
import { and, eq, exists, sql } from "drizzle-orm";
import type { SqliteBatchItem, WriteBatch } from "../batch.js";
import { chunkRows } from "../bound-parameters.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import {
	calendarEventIndexTable,
	calendarFeedTokenTable,
	calendarObjectTable,
	calendarTable,
	calendarTaskTable,
} from "../schema.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";
import { CalendarFeedTokenRepo } from "./calendar-feed-token.js";
import { CalendarObjectRepo } from "./calendar-object.js";

type DB = RepositoryDb;

type CalendarBatchWrite = Exclude<CalendarWrite, SettleCalendarSuggestionWrite>;

const isSettlement = (
	write: CalendarWrite,
): write is SettleCalendarSuggestionWrite => write.kind === "SettleSuggestion";

const isBatchWrite = (write: CalendarWrite): write is CalendarBatchWrite =>
	!isSettlement(write);

export class DrizzleCalendarStore implements ICalendarStore {
	readonly repos: CalendarRepositories;

	private readonly db: DB;
	private readonly batch: WriteBatch;
	private readonly maxBoundParameters: number;

	constructor(
		store: SqliteStore<Record<string, unknown>>,
		calendarSuggestion: ICalendarSuggestionRepository,
	) {
		this.db = store.db;
		this.batch = store.batch;
		this.maxBoundParameters = store.maxBoundParameters;
		this.repos = {
			calendarCollection: new CalendarCollectionRepo(store.db),
			calendarObject: new CalendarObjectRepo(store.db),
			calendarEventIndex: new CalendarEventIndexRepo(store),
			calendarSuggestion,
			calendarFeedToken: new CalendarFeedTokenRepo(store.db),
		};
	}

	async commit(
		writes: readonly CalendarWrite[],
	): Promise<CalendarCommitReport> {
		const items: SqliteBatchItem[] = [];
		const reprojections: { at: number; calendarObjectId: string }[] = [];
		for (const write of writes.filter(isBatchWrite)) {
			items.push(...this.statements(write));
			if (write.kind === "ReprojectObject") {
				reprojections.push({
					at: items.length - 1,
					calendarObjectId: deriveCalendarObjectId(
						write.object.calendarId,
						write.object.resourceName,
					),
				});
			}
		}
		const results: readonly unknown[] = await this.batch(items);
		const staleReprojections = reprojections
			.filter(({ at }) => {
				const written = results[at];
				return Array.isArray(written) && written.length === 0;
			})
			.map(({ calendarObjectId }) => calendarObjectId);
		for (const write of writes.filter(isSettlement)) {
			await this.repos.calendarSuggestion.settle(
				write.accountConfigId,
				write.suggestionId,
				write.settle,
			);
		}
		return { staleReprojections };
	}

	private collection(accountConfigId: string, calendarId: string) {
		return and(
			eq(calendarTable.accountConfigId, accountConfigId),
			eq(calendarTable.calendarId, calendarId),
		);
	}

	/**
	 * The sequence the bump just wrote, read inside the batch. A collection that
	 * is gone yields NULL, which the NOT NULL column refuses, so the whole batch
	 * fails rather than storing an orphan.
	 */
	private bumpedSequence(accountConfigId: string, calendarId: string) {
		return sql<number>`(${this.db
			.select({ syncSequence: calendarTable.syncSequence })
			.from(calendarTable)
			.where(this.collection(accountConfigId, calendarId))})`;
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

	private statements(write: CalendarBatchWrite): SqliteBatchItem[] {
		const now = Date.now();
		switch (write.kind) {
			case "PutObject": {
				const { calendarId, resourceName } = write.object;
				const calendarObjectId = deriveCalendarObjectId(
					calendarId,
					resourceName,
				);
				const syncSequence = this.bumpedSequence(
					write.accountConfigId,
					calendarId,
				);
				const items: SqliteBatchItem[] = [
					this.bump(write.accountConfigId, calendarId),
					this.db
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
						}),
					this.clearOccurrences(calendarId, calendarObjectId),
				];
				const occurrences = write.occurrences.map((occurrence) => ({
					...occurrence,
					calendarId,
					calendarObjectId,
					createdAt: now,
					updatedAt: now,
				}));
				return [
					...items,
					...chunkRows(
						calendarEventIndexTable,
						occurrences,
						this.maxBoundParameters,
					).map((slice) =>
						this.db.insert(calendarEventIndexTable).values(slice),
					),
				];
			}
			case "ReprojectObject": {
				const { calendarId, resourceName } = write.object;
				const calendarObjectId = deriveCalendarObjectId(
					calendarId,
					resourceName,
				);
				// Every statement reads the object it rewrites at the version the
				// caller read, so a resource edited or deleted since writes nothing.
				// The object's own update runs last, so the occurrence statements still
				// see that version, and it returns the row it wrote, so the commit can
				// tell a stale read from a written one.
				const asRead = and(
					eq(calendarObjectTable.calendarObjectId, calendarObjectId),
					eq(calendarObjectTable.etag, write.readEtag),
				);
				const unchanged = exists(
					this.db
						.select({ id: calendarObjectTable.calendarObjectId })
						.from(calendarObjectTable)
						.where(asRead),
				);
				const value = <T>(field: T, name: string) => sql<T>`${field}`.as(name);
				return [
					this.bump(write.accountConfigId, calendarId),
					this.db
						.delete(calendarEventIndexTable)
						.where(
							and(
								eq(calendarEventIndexTable.calendarId, calendarId),
								eq(calendarEventIndexTable.calendarObjectId, calendarObjectId),
								unchanged,
							),
						),
					...write.occurrences.map((occurrence) =>
						this.db.insert(calendarEventIndexTable).select(
							this.db
								.select({
									calendarId: value(calendarId, "calendar_id"),
									calendarObjectId: value(
										calendarObjectId,
										"calendar_object_id",
									),
									recurrenceId: value(occurrence.recurrenceId, "recurrence_id"),
									startAt: value(occurrence.startAt, "start_at"),
									endAt: value(occurrence.endAt, "end_at"),
									allDay: value(occurrence.allDay ? 1 : 0, "all_day"),
									summary: value(occurrence.summary, "summary"),
									status: value(occurrence.status, "status"),
									transparency: value(occurrence.transparency, "transparency"),
									createdAt: value(now, "created_at"),
									updatedAt: value(now, "updated_at"),
								})
								.from(calendarObjectTable)
								.where(asRead),
						),
					),
					this.db
						.update(calendarObjectTable)
						.set({
							...write.object,
							syncSequence: this.bumpedSequence(
								write.accountConfigId,
								calendarId,
							),
							updatedAt: now,
						})
						.where(asRead)
						.returning({ id: calendarObjectTable.calendarObjectId }),
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
						.delete(calendarTaskTable)
						.where(eq(calendarTaskTable.calendarId, write.calendarId)),
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
