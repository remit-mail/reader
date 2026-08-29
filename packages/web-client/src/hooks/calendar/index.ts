/**
 * What every calendar surface reads and writes, in one module.
 *
 * The grid, the reading pane and the day strip all ask the same questions, so
 * they ask them through the same hooks: one window is fetched once however many
 * of them are on screen, and a write invalidates what all of them are showing.
 */
export {
	type CreateInput,
	createInputFromDraft,
	type DraftRefusal,
	draftFromEvent,
	emptyDraft,
	patchFromDrafts,
	type UpdatePatch,
} from "./draft";
export {
	type CalendarInstanceRef,
	calendarInstanceId,
	deviceTimeZone,
	isDrawnInstance,
	readCalendarInstanceId,
	toCalendarDescriptor,
	toCalendarEventData,
} from "./instance";
export { rruleFromText, textFromRrule } from "./recurrence-rule";
export {
	type CalendarResourceText,
	rruleFromIcalData,
	textFromIcalData,
} from "./resource";
export {
	type CalendarEventResource,
	useCalendarEvent,
} from "./useCalendarEvent";
export {
	type CalendarEventWindowRequest,
	type CalendarEventWindowResult,
	useCalendarEventWindow,
	usePrefetchAdjacentWindows,
} from "./useCalendarEvents";
export { type CalendarsResult, useCalendars } from "./useCalendars";
export {
	type CalendarWriteOutcome,
	type CalendarWrites,
	type ScopedWrite,
	useCalendarWrites,
	useInvalidateCalendarReads,
} from "./useCalendarWrites";
export {
	addDays,
	type CalendarWindow,
	calendarWindow,
	calendarWindowOfDays,
	isoAt,
	startOfDay,
} from "./window";
