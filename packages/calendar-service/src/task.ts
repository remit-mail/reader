import type {
	CalendarCollectionItem,
	CalendarTaskItem,
	ICalendarTaskRepository,
	PutCalendarTaskInput,
} from "@remit/data-ports";
import ICAL from "ical.js";
import { CALENDAR_PRODID, readEventTime } from "./build.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { computeEtag } from "./etag.js";
import { readCalendarComponent, serializeCalendar } from "./parse.js";
import { readString } from "./project.js";
import { resolveTime, tzidOf } from "./time.js";

/** A task as a person describes it, before it is iCalendar. */
export interface CalendarTaskFields {
	summary: string;
	description: string;
	/** ISO 8601 with a zone offset, or `YYYY-MM-DD` when `allDay`. */
	due: string;
	allDay: boolean;
	/** IANA zone the due time is anchored in. `""` anchors it in UTC. */
	timeZone: string;
	completed: boolean;
}

interface ParsedTask {
	component: ICAL.Component;
	todo: ICAL.Component;
	uid: string;
}

/** Reads a VCALENDAR carrying exactly one VTODO with a UID and a DUE. */
export const parseTaskCalendar = async (
	icalData: string,
): Promise<CalendarResult<ParsedTask>> => {
	const read = await readCalendarComponent(icalData);
	if (!read.ok) return read;
	const component = read.value;
	if (component.name !== "vcalendar") {
		return calendarFailure("NotACalendar", "expected a VCALENDAR");
	}
	const todos = component.getAllSubcomponents("vtodo");
	if (todos.length !== 1 || component.getAllSubcomponents("vevent").length) {
		return calendarFailure(
			"UnsupportedComponent",
			"a task resource holds exactly one VTODO and no VEVENT",
		);
	}
	const todo = todos[0] as ICAL.Component;
	const uid = todo.getFirstPropertyValue("uid");
	if (typeof uid !== "string" || uid === "") {
		return calendarFailure("MissingUid", "the VTODO declares no UID");
	}
	if (!(todo.getFirstPropertyValue("due") instanceof ICAL.Time)) {
		return calendarFailure("MissingDtStart", "the VTODO declares no DUE");
	}
	return { ok: true, value: { component, todo, uid } };
};

const setText = (todo: ICAL.Component, name: string, value: string): void => {
	todo.removeAllProperties(name);
	if (value !== "") todo.addPropertyWithValue(name, value);
};

const currentFields = (
	todo: ICAL.Component,
	collectionTimezone: string,
): CalendarTaskFields => {
	const due = todo.getFirstPropertyValue("due");
	const tzid = tzidOf(todo.getFirstProperty("due"));
	const resolved =
		due instanceof ICAL.Time
			? resolveTime(due, tzid, collectionTimezone)
			: null;
	return {
		summary: readString(todo, "summary"),
		description: readString(todo, "description"),
		due: resolved
			? resolved.isDate
				? resolved.isoOffset.slice(0, 10)
				: resolved.isoOffset
			: "",
		allDay: resolved?.isDate ?? false,
		timeZone: tzid,
		completed: readString(todo, "status").toUpperCase() === "COMPLETED",
	};
};

/**
 * Writes a patch onto a VTODO. The due fields are one fact between them, so
 * touching any rewrites DUE from the values the task would then have.
 */
const applyTaskFields = (
	todo: ICAL.Component,
	patch: Partial<CalendarTaskFields>,
	collectionTimezone: string,
	now: Date,
): CalendarResult<null> => {
	if (patch.summary !== undefined) setText(todo, "summary", patch.summary);
	if (patch.description !== undefined) {
		setText(todo, "description", patch.description);
	}
	if (patch.completed !== undefined) {
		setText(todo, "status", patch.completed ? "COMPLETED" : "NEEDS-ACTION");
		todo.removeAllProperties("completed");
		if (patch.completed) {
			todo.addPropertyWithValue("completed", ICAL.Time.fromJSDate(now, true));
		}
	}
	const touchesDue =
		patch.due !== undefined ||
		patch.allDay !== undefined ||
		patch.timeZone !== undefined;
	if (!touchesDue) return { ok: true, value: null };

	const current = todo.hasProperty("due")
		? currentFields(todo, collectionTimezone)
		: { due: "", allDay: false, timeZone: "" };
	const allDay = patch.allDay ?? current.allDay;
	const timeZone = patch.timeZone ?? current.timeZone;
	const due = readEventTime(patch.due ?? current.due, allDay, timeZone);
	if (!due.ok) return due;
	todo.removeAllProperties("due");
	const property = new ICAL.Property("due");
	todo.addProperty(property);
	property.setValue(due.value);
	if (!due.value.isDate && timeZone !== "") {
		property.setParameter("tzid", timeZone);
	}
	return { ok: true, value: null };
};

/** Builds the VCALENDAR text for a new task. */
export const buildTaskCalendar = (
	fields: CalendarTaskFields,
	uid: string,
	now: Date,
): CalendarResult<string> => {
	const calendar = new ICAL.Component("vcalendar");
	calendar.addPropertyWithValue("version", "2.0");
	calendar.addPropertyWithValue("prodid", CALENDAR_PRODID);
	const todo = new ICAL.Component("vtodo");
	calendar.addSubcomponent(todo);
	todo.addPropertyWithValue("uid", uid);
	todo.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
	const applied = applyTaskFields(todo, fields, fields.timeZone, now);
	if (!applied.ok) return applied;
	return { ok: true, value: serializeCalendar(calendar) };
};

/** Rewrites a stored task with a patch. */
export const updateTaskCalendar = async (
	icalData: string,
	patch: Partial<CalendarTaskFields>,
	collectionTimezone: string,
	now: Date,
): Promise<CalendarResult<string>> => {
	const parsed = await parseTaskCalendar(icalData);
	if (!parsed.ok) return parsed;
	const { todo, component } = parsed.value;
	const applied = applyTaskFields(todo, patch, collectionTimezone, now);
	if (!applied.ok) return applied;
	todo.removeAllProperties("dtstamp");
	todo.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
	return { ok: true, value: serializeCalendar(component) };
};

/** Turns one task resource into the row that stores it. */
export const prepareCalendarTask = async (
	collection: Pick<CalendarCollectionItem, "calendarId" | "timezone">,
	resourceName: string,
	icalData: string,
): Promise<CalendarResult<PutCalendarTaskInput>> => {
	const parsed = await parseTaskCalendar(icalData);
	if (!parsed.ok) return parsed;
	const { todo, uid } = parsed.value;
	const fields = currentFields(todo, collection.timezone);
	const due = resolveTime(
		todo.getFirstPropertyValue("due") as ICAL.Time,
		tzidOf(todo.getFirstProperty("due")),
		collection.timezone,
	);
	return {
		ok: true,
		value: {
			calendarId: collection.calendarId,
			resourceName,
			icalUid: uid,
			icalData,
			etag: computeEtag(icalData),
			summary: fields.summary,
			description: fields.description,
			due: due.isoOffset,
			dueAt: due.isoUtc,
			allDay: due.isDate,
			completed: fields.completed,
		},
	};
};

/** Every task due in a window, across the collections given, in due order. */
export const listTasksInWindow = async (
	repository: Pick<ICalendarTaskRepository, "listByDueRange">,
	collections: readonly CalendarCollectionItem[],
	window: { from: string; to: string },
): Promise<CalendarTaskItem[]> => {
	const tasks: CalendarTaskItem[] = [];
	for (const collection of collections) {
		tasks.push(
			...(await repository.listByDueRange(
				collection.calendarId,
				window.from,
				window.to,
			)),
		);
	}
	return tasks.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
};
