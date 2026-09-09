/**
 * The calendar tables against the shape a deployment actually runs: every
 * committed entity migration applied in journal order to an empty database,
 * rather than a schema pushed from the drizzle table objects.
 *
 * Nothing else ran these files. Every calendar SQLite test builds its database
 * with `createSqliteTestDb`, which regenerates the DDL from the table objects on
 * each run, and the drift guard only diffs the latest snapshot — so a migration
 * that fails to apply, or applies to a different shape than its snapshot claims,
 * passes the whole suite while a self-host upgrade breaks. That is reader#73 one
 * layer up: there the shipped DDL was wrong, here the shipped DDL was never
 * executed at all.
 *
 * Everything below walks the journal, so a migration added tomorrow is covered
 * the moment it is committed.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	CalendarEventStatus,
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
	CalendarTransparency,
	ZoneCertainty,
} from "@remit/domain-enums";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "../db.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarSuggestionTable,
	calendarTable,
} from "../schema.js";
import {
	applyMigration,
	migrationJournal,
	migrationSnapshot,
	migrationTagsOnDisk,
} from "../test-shipped-sqlite-schema.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";
import { CalendarObjectRepo } from "./calendar-object.js";
import { CalendarSuggestionRepo } from "./calendar-suggestion.js";

const ACCOUNT_CONFIG_ID = "account-config-shipped";
const ROOT_SNAPSHOT_PREV_ID = "00000000-0000-0000-0000-000000000000";

const ICAL_DATA = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:shipped@example.test",
	"DTSTART:20260901T080000Z",
	"DTEND:20260901T090000Z",
	"SUMMARY:Shipped-migrations round trip",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

describe("the committed sqlite migration journal", () => {
	const entries = migrationJournal();

	test("names each migration once, in a strictly rising order", () => {
		// Not "consecutive": drizzle-kit skipped 0009, and a withdrawn number is
		// harmless. A repeated or reordered one is not — two branches generating
		// against the same predecessor is the collision this pins.
		for (const [position, entry] of entries.entries()) {
			const previous = entries[position - 1];
			assert.ok(
				previous === undefined || entry.idx > previous.idx,
				`journal entry ${entry.tag} does not follow ${previous?.tag}`,
			);
			assert.equal(
				entry.tag.slice(0, 4),
				String(entry.idx).padStart(4, "0"),
				`journal entry ${entry.tag} is filed under idx ${entry.idx}`,
			);
		}
	});

	test("accounts for every migration file on disk", () => {
		// An orphan .sql is a migration a deployment never runs; a journal entry
		// with no file is one that crashes the migrator on the next upgrade.
		assert.deepEqual(
			migrationTagsOnDisk(),
			entries.map((entry) => entry.tag).sort(),
		);
	});

	test("chains every snapshot to its predecessor", () => {
		for (const [position, entry] of entries.entries()) {
			const snapshot = migrationSnapshot(entry.idx);
			const previous = entries[position - 1];
			assert.equal(
				snapshot.prevId,
				previous === undefined
					? ROOT_SNAPSHOT_PREV_ID
					: migrationSnapshot(previous.idx).id,
				`snapshot ${entry.tag} does not follow ${previous?.tag ?? "the root"}`,
			);
		}
	});
});

describe("the calendar tables under the shipped migrations", () => {
	let sqlite: Database.Database;
	let db: Db<Record<string, unknown>>;

	before(() => {
		sqlite = new Database(":memory:");
		for (const entry of migrationJournal()) {
			applyMigration(sqlite, entry.tag);
		}
		sqlite.pragma("foreign_keys = ON");
		db = drizzle(sqlite, {
			schema: {
				calendars: calendarTable,
				calendarObjects: calendarObjectTable,
				calendarEventIndexes: calendarEventIndexTable,
				calendarSuggestions: calendarSuggestionTable,
			},
		}) as unknown as Db<Record<string, unknown>>;
	});

	after(() => {
		sqlite.close();
	});

	test("leaves all four calendar tables behind", () => {
		const present = new Set(
			sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((row) => (row as { name: string }).name),
		);

		for (const table of [
			"calendar",
			"calendar_object",
			"calendar_event_index",
			"calendar_suggestion",
		]) {
			assert.ok(present.has(table), `${table} was never created`);
		}
	});

	test("round-trips a collection", async () => {
		const repo = new CalendarCollectionRepo(db);

		const created = await repo.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			urlSegment: "shipped",
			displayName: "Shipped",
		});

		const fetched = await repo.get(ACCOUNT_CONFIG_ID, created.calendarId);
		assert.equal(fetched.displayName, "Shipped");
		assert.equal(fetched.urlSegment, "shipped");
		assert.equal(fetched.syncSequence, 0);
	});

	test("round-trips an object and its occurrence", async () => {
		const collection = await new CalendarCollectionRepo(db).create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			urlSegment: "objects",
			displayName: "Objects",
		});
		const objects = new CalendarObjectRepo(db);

		const written = await objects.put({
			calendarId: collection.calendarId,
			resourceName: "shipped.ics",
			icalUid: "shipped@example.test",
			icalData: ICAL_DATA,
			etag: "b".repeat(64),
			sequence: 0,
			syncSequence: 1,
			summary: "Shipped-migrations round trip",
			dtStart: "2026-09-01T08:00:00+00:00",
			dtEnd: "2026-09-01T09:00:00+00:00",
			allDay: false,
			zoneCertainty: ZoneCertainty.Explicit,
			status: CalendarEventStatus.Confirmed,
			transparency: CalendarTransparency.Opaque,
			hasRecurrence: false,
			expandedThrough: "",
		});

		const fetched = await objects.get(
			collection.calendarId,
			written.calendarObjectId,
		);
		assert.equal(fetched.icalData, ICAL_DATA);
		assert.equal(fetched.summary, "Shipped-migrations round trip");
		assert.equal(fetched.allDay, false);

		const index = new CalendarEventIndexRepo(db);
		await index.replaceForObject(
			collection.calendarId,
			written.calendarObjectId,
			[
				{
					recurrenceId: "",
					startAt: "2026-09-01T08:00:00Z",
					endAt: "2026-09-01T09:00:00Z",
					allDay: false,
					// The three columns 0018 added. A migration that never ran leaves
					// the repo selecting columns the table does not have.
					summary: "Shipped-migrations round trip",
					status: CalendarEventStatus.Confirmed,
					transparency: CalendarTransparency.Opaque,
				},
			],
		);

		const occurrences = await index.listForObject(
			collection.calendarId,
			written.calendarObjectId,
		);
		assert.equal(occurrences.length, 1);
		assert.equal(occurrences[0]?.startAt, "2026-09-01T08:00:00Z");
		assert.equal(occurrences[0]?.summary, "Shipped-migrations round trip");
		assert.equal(occurrences[0]?.status, CalendarEventStatus.Confirmed);
		assert.equal(occurrences[0]?.transparency, CalendarTransparency.Opaque);
	});

	test("round-trips a suggestion", async () => {
		const repo = new CalendarSuggestionRepo(db);

		const written = await repo.put({
			accountConfigId: ACCOUNT_CONFIG_ID,
			messageId: "message-1",
			bodyPartId: "body-part-1",
			icalUid: "invite@example.test",
			sequence: 0,
			method: CalendarInviteMethod.Request,
			source: CalendarSuggestionSource.IcalendarPart,
			summary: "Design review",
			dtStart: "2026-09-01T10:00:00+02:00",
			dtEnd: "2026-09-01T11:00:00+02:00",
			allDay: false,
			location: "",
			organizer: "organizer@example.test",
			zoneCertainty: ZoneCertainty.Explicit,
			icalData: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
		});

		const fetched = await repo.get(ACCOUNT_CONFIG_ID, written.suggestionId);
		assert.equal(fetched.summary, "Design review");
		assert.equal(fetched.state, CalendarSuggestionState.Pending);
		assert.equal(fetched.acceptedCalendarObjectId, "");
		assert.equal(fetched.organizer, "organizer@example.test");
	});
});
