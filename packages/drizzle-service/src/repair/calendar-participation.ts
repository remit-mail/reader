import { prepareCalendarObject } from "@remit/calendar-service";
import type { ICalendarStore } from "@remit/data-ports";
import { CalendarParticipation } from "@remit/domain-enums";

export interface ParticipationRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
}

export type ParticipationRepairMode = "check" | "repair";

export interface ParticipationRepairReport {
	readonly mode: ParticipationRepairMode;
	readonly scanned: number;
	readonly rewritten: number;
}

/**
 * The resources a guest list could give a participation to that every
 * occurrence row still reads as `Unscheduled`: rows written before the column
 * existed. A resource whose reader is on none of its lines stays a candidate
 * and is rewritten to the same answer, which is a read and no write.
 */
const CANDIDATES_SQL = `SELECT c.account_config_id AS accountConfigId,
	o.calendar_id AS calendarId,
	o.calendar_object_id AS calendarObjectId
FROM calendar_object o
JOIN calendar c ON c.calendar_id = o.calendar_id
WHERE o.ical_data LIKE '%ATTENDEE%'
AND NOT EXISTS (
	SELECT 1 FROM calendar_event_index i
	WHERE i.calendar_id = o.calendar_id
	AND i.calendar_object_id = o.calendar_object_id
	AND i.participation <> 'Unscheduled'
)`;

interface Candidate {
	accountConfigId: string;
	calendarId: string;
	calendarObjectId: string;
}

const isCandidate = (row: unknown): row is Candidate =>
	typeof row === "object" &&
	row !== null &&
	typeof Reflect.get(row, "accountConfigId") === "string" &&
	typeof Reflect.get(row, "calendarId") === "string" &&
	typeof Reflect.get(row, "calendarObjectId") === "string";

/**
 * Re-projects the occurrence rows of every stored event that carries ATTENDEE
 * lines, so the reader's own answer reaches the listing (issue #1508). Runs in
 * the one-shot migrator, never on a request: it reads every such resource.
 * Each rewrite is conditional on the etag it read, so an edit landing
 * meanwhile wins.
 */
export const sweepCalendarParticipation = async (
	client: ParticipationRepairClient,
	store: ICalendarStore,
	selfAddressesOf: (accountConfigId: string) => Promise<string[]>,
	mode: ParticipationRepairMode,
): Promise<ParticipationRepairReport> => {
	const candidates = (await client.all(CANDIDATES_SQL, [])).filter(isCandidate);
	let rewritten = 0;
	for (const candidate of candidates) {
		const object = await store.repos.calendarObject.find(
			candidate.calendarId,
			candidate.calendarObjectId,
		);
		if (!object) continue;
		const collection = await store.repos.calendarCollection.get(
			candidate.accountConfigId,
			candidate.calendarId,
		);
		const prepared = await prepareCalendarObject(collection, {
			accountConfigId: candidate.accountConfigId,
			calendarId: candidate.calendarId,
			resourceName: object.resourceName,
			icalData: object.icalData,
			selfAddresses: await selfAddressesOf(candidate.accountConfigId),
		});
		if (!prepared.ok) continue;
		const answered = prepared.value.occurrences.some(
			(occurrence) =>
				occurrence.participation !== CalendarParticipation.Unscheduled,
		);
		if (!answered) continue;
		rewritten += 1;
		if (mode === "check") continue;
		await store.commit([
			{ ...prepared.value, kind: "ReprojectObject", readEtag: object.etag },
		]);
	}
	return { mode, scanned: candidates.length, rewritten };
};

export const formatParticipationReport = (
	report: ParticipationRepairReport,
): string[] => [
	`${report.mode === "check" ? "would re-project" : "re-projected"} ${report.rewritten} of ${report.scanned} events with guests`,
];
