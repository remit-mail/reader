import type {
	CalendarOccurrenceInput,
	PutCalendarObjectInput,
	UpdateCalendarCollectionInput,
} from "../types.js";
import type { ICalendarCollectionRepository } from "./calendar-collection.js";
import type { ICalendarEventIndexRepository } from "./calendar-event-index.js";
import type { ICalendarFeedTokenRepository } from "./calendar-feed-token.js";
import type { ICalendarObjectRepository } from "./calendar-object.js";
import type {
	ICalendarSuggestionRepository,
	SettleCalendarSuggestionInput,
} from "./calendar-suggestion.js";

/** The repositories a calendar write set reads before it commits. */
export interface CalendarRepositories {
	calendarCollection: ICalendarCollectionRepository;
	calendarObject: ICalendarObjectRepository;
	calendarEventIndex: ICalendarEventIndexRepository;
	calendarSuggestion: ICalendarSuggestionRepository;
	calendarFeedToken: ICalendarFeedTokenRepository;
}

/**
 * Writes one resource: bumps the collection's sequence, stores the object at
 * the bumped value and replaces its occurrence rows. The object's id derives
 * from `(calendarId, resourceName)`, so the write needs no read of its own.
 */
export interface PutCalendarObjectWrite {
	kind: "PutObject";
	accountConfigId: string;
	object: Omit<PutCalendarObjectInput, "syncSequence">;
	occurrences: CalendarOccurrenceInput[];
}

/**
 * Rewrites a resource that is already stored, the way a put does, but only
 * while it is still the version that was read: a resource edited or deleted
 * since stays as that edit left it.
 * A collection whose timezone changed re-projects every resource this way.
 */
export interface ReprojectCalendarObjectWrite
	extends Omit<PutCalendarObjectWrite, "kind"> {
	kind: "ReprojectObject";
	/** The etag the resource carried when it was read; a later edit wins. */
	readEtag: string;
}

/** Removes a resource with its occurrence rows, and bumps the sequence. */
export interface DeleteCalendarObjectWrite {
	kind: "DeleteObject";
	accountConfigId: string;
	calendarId: string;
	calendarObjectId: string;
}

/**
 * Settles a suggestion card. Present so accepting a suggestion settles the card
 * in the same commit that writes the resource (issue #1033): a card still
 * asking with the event already in the calendar, or a card marked accepted with
 * no event behind it, is a state nothing later can repair.
 */
export interface SettleCalendarSuggestionWrite {
	kind: "SettleSuggestion";
	accountConfigId: string;
	suggestionId: string;
	settle: SettleCalendarSuggestionInput;
}

export interface UpdateCalendarCollectionWrite {
	kind: "UpdateCollection";
	accountConfigId: string;
	calendarId: string;
	patch: UpdateCalendarCollectionInput;
}

/**
 * Removes a collection with every resource, occurrence and its feed address
 * (issue #1067). A token row outliving its collection is a credential pointing
 * at nothing: it answers 404, but nobody can see it to revoke it, and a later
 * calendar under the same derived id would inherit it.
 */
export interface DeleteCalendarCollectionWrite {
	kind: "DeleteCollection";
	accountConfigId: string;
	calendarId: string;
}

export type CalendarWrite =
	| PutCalendarObjectWrite
	| ReprojectCalendarObjectWrite
	| DeleteCalendarObjectWrite
	| SettleCalendarSuggestionWrite
	| UpdateCalendarCollectionWrite
	| DeleteCalendarCollectionWrite;

/**
 * The calendar store (issue #15). Reads go through `repos`; a write set is a
 * list of writes that `commit` applies as one atomic batch, in order. Writing a
 * resource is three writes — the object, its replaced occurrence rows and the
 * collection's sequence bump — and none of them is meaningful without the
 * others: an object with stale occurrences is a calendar showing events the
 * resource no longer has, and an object written without the bump is a change
 * no sync report will ever hand a client.
 *
 * Nothing inside a commit reads: every decision is made against what `repos`
 * returned before it, and a write that a stale read would get wrong is keyed so
 * that repeating or racing it converges (derived ids, upserts).
 */
export interface ICalendarStore {
	readonly repos: CalendarRepositories;
	commit(writes: readonly CalendarWrite[]): Promise<void>;
}
