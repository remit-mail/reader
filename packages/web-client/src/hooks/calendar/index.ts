/**
 * What every calendar surface reads and writes, in one module.
 *
 * The grid, the reading pane and the day strip all ask the same questions, so
 * they ask them through the same hooks: one window is fetched once however many
 * of them are on screen, and a write invalidates what all of them are showing.
 */
export {
	type AgendaRange,
	busySpansByDate,
	CAP_WEEKS,
	datesInRange,
	extendRangeEnd,
	extendRangeStart,
	type FreeLookup,
	freeStretchesByDate,
	LEAD_IN,
	LEAD_OUT,
	liftRangeCeiling,
	liftRangeFloor,
	PAGE,
	rangeAround,
	rangeAtCeiling,
	rangeAtFloor,
	rangeCovering,
	weekKeyOf,
	weekWindowsOver,
} from "./agenda-window";
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
	UNZONED_CALENDAR,
} from "./instance";
export { rruleFromText, textFromRrule } from "./recurrence-rule";
export {
	type CalendarResourceText,
	rruleFromIcalData,
	textFromIcalData,
} from "./resource";
export {
	type CalendarSelection,
	selectCalendarIds,
	useCalendarSelection,
	useDrawnEvents,
} from "./selection";
export {
	type CalendarEventResource,
	useCalendarEvent,
} from "./useCalendarEvent";
export {
	CALENDAR_WINDOW_STALE_TIME,
	type CalendarEventWeeksResult,
	type CalendarEventWindowRequest,
	type CalendarEventWindowResult,
	useCalendarEventWeeks,
	useCalendarEventWindow,
	usePrefetchAdjacentWindows,
} from "./useCalendarEvents";
export {
	type CalendarFreeBusyResult,
	useCalendarFreeBusyWeeks,
} from "./useCalendarFreeBusy";
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
	isoAtInZone,
	startOfDay,
} from "./window";
