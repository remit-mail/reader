import type {
	CalendarSuggestionItem,
	ICalendarSuggestionRepository,
	PutCalendarSuggestionInput,
} from "@remit/data-ports";
import {
	CalendarInviteMethod,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import type ICAL from "ical.js";
import type { CalendarResult } from "./errors.js";
import { parseCalendar } from "./parse.js";
import { projectCalendar } from "./project.js";

const METHOD_BY_ICAL: Record<string, CalendarSuggestionItem["method"]> = {
	REQUEST: CalendarInviteMethod.Request,
	REPLY: CalendarInviteMethod.Reply,
	CANCEL: CalendarInviteMethod.Cancel,
	COUNTER: CalendarInviteMethod.Counter,
	PUBLISH: CalendarInviteMethod.Publish,
};

const readString = (component: ICAL.Component, name: string): string => {
	const value = component.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
};

/**
 * A `CAL-ADDRESS` as a plain mail address. RFC 5545 3.3.3 writes one as a URI,
 * which in practice is always `mailto:`; a card shows a person, not a URI.
 */
export const mailAddressOf = (calAddress: string): string =>
	calAddress.replace(/^mailto:/i, "");

/** The iTIP method a VCALENDAR declared, `None` when it declared no METHOD. */
export const inviteMethodOf = (
	component: ICAL.Component,
): CalendarSuggestionItem["method"] =>
	METHOD_BY_ICAL[readString(component, "method").toUpperCase()] ??
	CalendarInviteMethod.None;

/**
 * The facts a suggestion carries beside its bytes, read out of the message's
 * iCalendar and nowhere else. Shares `projectCalendar` with the stored
 * resource, so a card and the event it becomes cannot disagree about when the
 * meeting is.
 */
export type CalendarSuggestionProjection = Pick<
	PutCalendarSuggestionInput,
	| "icalUid"
	| "sequence"
	| "method"
	| "summary"
	| "dtStart"
	| "dtEnd"
	| "allDay"
	| "location"
	| "organizer"
	| "zoneCertainty"
>;

/**
 * Reads a message's `text/calendar` bytes into the facts a card is drawn from.
 *
 * Refusal is a returned value, as everywhere else in this package: the bytes
 * come from whatever client the organizer uses, and a mail carrying broken
 * iCalendar is an ordinary thing that must not fail the message's body sync.
 */
export const projectSuggestion = async (
	icalData: string,
	timezone: string,
): Promise<CalendarResult<CalendarSuggestionProjection>> => {
	const parsed = await parseCalendar(icalData);
	if (!parsed.ok) return parsed;

	const projection = projectCalendar(parsed.value, timezone);
	if (!projection.ok) return projection;

	return {
		ok: true,
		value: {
			icalUid: projection.value.icalUid,
			sequence: projection.value.sequence,
			method: inviteMethodOf(parsed.value.component),
			summary: projection.value.summary,
			dtStart: projection.value.dtStart,
			dtEnd: projection.value.dtEnd,
			allDay: projection.value.allDay,
			location: readString(parsed.value.master, "location"),
			organizer: mailAddressOf(readString(parsed.value.master, "organizer")),
			zoneCertainty: projection.value.zoneCertainty,
		},
	};
};

export interface RecordCalendarSuggestionInput {
	accountConfigId: string;
	messageId: string;
	bodyPartId: string;
	source: CalendarSuggestionItem["source"];
	/** The VCALENDAR text as it arrived in the message. */
	icalData: string;
	/** IANA zone a floating time in the invitation is read in. */
	timezone: string;
}

export interface RecordedCalendarSuggestion {
	suggestion: CalendarSuggestionItem;
	/** The revisions this one replaced, already marked `Superseded`. */
	superseded: CalendarSuggestionItem[];
}

/**
 * Every pending suggestion the account holds. Drained rather than read as one
 * page: the page size is a repository detail, and a supersession that missed
 * the older revision because it sat on page two would leave two live cards for
 * one event.
 */
const listPending = async (
	repo: ICalendarSuggestionRepository,
	accountConfigId: string,
): Promise<CalendarSuggestionItem[]> => {
	const items: CalendarSuggestionItem[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await repo.listByState(
			accountConfigId,
			CalendarSuggestionState.Pending,
			{ continuationToken },
		);
		items.push(...page.items);
		continuationToken = page.continuationToken;
	} while (continuationToken);
	return items;
};

/**
 * Records what one message offers, and retires the revision it replaces.
 *
 * A revision is a new row, never an edit. The organizer's `SEQUENCE` is what
 * orders them (RFC 5545 3.8.7.4): a later message carrying the same `UID` with
 * a higher value leaves the earlier card in place as `Superseded` and writes a
 * new `Pending` one, so the message the old card came from still has its card
 * and the user can see which revision they are being asked about.
 *
 * Only a `Pending` suggestion is superseded. An answered one is a decision the
 * user already took, and a later message does not get to erase it — a
 * cancellation of an accepted event arrives as its own `Cancel` suggestion and
 * waits for the user like everything else.
 *
 * The new row is written before the old ones are retired. A failure between
 * the two leaves two live cards, which a person can see and act on; the other
 * order would leave the event with none.
 */
export const recordCalendarSuggestion = async (
	repo: ICalendarSuggestionRepository,
	input: RecordCalendarSuggestionInput,
): Promise<CalendarResult<RecordedCalendarSuggestion>> => {
	const projection = await projectSuggestion(input.icalData, input.timezone);
	if (!projection.ok) return projection;

	const suggestion = await repo.put({
		accountConfigId: input.accountConfigId,
		messageId: input.messageId,
		bodyPartId: input.bodyPartId,
		source: input.source,
		icalData: input.icalData,
		...projection.value,
	});

	const stale = (await listPending(repo, input.accountConfigId)).filter(
		(candidate) =>
			candidate.icalUid === suggestion.icalUid &&
			candidate.suggestionId !== suggestion.suggestionId &&
			candidate.sequence < suggestion.sequence,
	);

	const superseded = [];
	for (const candidate of stale) {
		superseded.push(
			await repo.settle(input.accountConfigId, candidate.suggestionId, {
				state: CalendarSuggestionState.Superseded,
				acceptedCalendarObjectId: "",
			}),
		);
	}

	return { ok: true, value: { suggestion, superseded } };
};
