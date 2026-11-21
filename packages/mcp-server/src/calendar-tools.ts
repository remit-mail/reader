import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type CalendarOperationsListCalendarsData,
	calendarDetailOperationsDeleteCalendar,
	calendarDetailOperationsGetCalendar,
	calendarDetailOperationsGetCalendarFeed,
	calendarDetailOperationsPutCalendarFeed,
	calendarDetailOperationsRevokeCalendarFeed,
	calendarDetailOperationsUpdateCalendar,
	calendarEventDetailOperationsDeleteCalendarEvent,
	calendarEventDetailOperationsGetCalendarEvent,
	calendarEventDetailOperationsUpdateCalendarEvent,
	calendarEventOperationsCreateCalendarEvent,
	calendarEventOperationsListCalendarEvents,
	calendarFreeBusyOperationsListCalendarFreeBusy,
	calendarOperationsCreateCalendar,
	calendarOperationsListCalendars,
	calendarSuggestionActionOperationsAcceptCalendarSuggestion,
	calendarSuggestionActionOperationsDeclineCalendarSuggestion,
	calendarSuggestionActionOperationsDismissCalendarSuggestion,
	calendarSuggestionActionOperationsReopenCalendarSuggestion,
	calendarSuggestionOperationsListCalendarSuggestions,
	calendarTaskDetailOperationsDeleteCalendarTask,
	calendarTaskDetailOperationsGetCalendarTask,
	calendarTaskDetailOperationsUpdateCalendarTask,
	calendarTaskOperationsCreateCalendarTask,
	calendarTaskOperationsListCalendarTasks,
	messageCalendarSuggestionOperationsListMessageCalendarSuggestions,
	type Options,
} from "@remit/api-http-client";
import {
	AcceptCalendarSuggestionInputSchema,
	CalendarEventInstanceSchema,
	CalendarEventResponseSchema,
	CalendarListResponseSchema,
	CalendarResponseSchema,
	CalendarSuggestionResponseSchema,
	CalendarSuggestionStateSchema,
	CalendarTaskResponseSchema,
	CreateCalendarEventInputSchema,
	CreateCalendarInputSchema,
	CreateCalendarTaskInputSchema,
	DismissCalendarSuggestionInputSchema,
	MailboxListResponseSchema,
	RecurrenceScopeSchema,
	UpdateCalendarEventInputSchema,
	UpdateCalendarInputSchema,
	UpdateCalendarTaskInputSchema,
} from "@remit/api-zod-schemas";
import { asJson } from "./tool-result.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
} as const;
const EXTERNAL_WRITE = { ...WRITE, openWorldHint: true } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;
const EXTERNAL_DESTRUCTIVE = {
	...DESTRUCTIVE,
	openWorldHint: true,
} as const;

const calendarId = CalendarResponseSchema.shape.calendarId;
const calendarIds =
	CalendarListResponseSchema.shape.items.element.shape.calendarId
		.array()
		.optional();
const calendarObjectId = CalendarEventResponseSchema.shape.calendarObjectId;
const calendarTaskId = CalendarTaskResponseSchema.shape.calendarTaskId;
const suggestionId = CalendarSuggestionResponseSchema.shape.suggestionId;
const messageId = CalendarSuggestionResponseSchema.shape.messageId;
const from = CalendarEventInstanceSchema.shape.start;
const to = CalendarEventInstanceSchema.shape.end;
const recurrenceId = CalendarEventInstanceSchema.shape.recurrenceId.optional();
const scope = RecurrenceScopeSchema.optional();
const ifMatch = CalendarEventResponseSchema.shape.etag.optional();
const continuationToken =
	MailboxListResponseSchema.shape.continuationToken.optional();

const asApiJson = (result: { data: unknown }) => asJson(result.data ?? null);

export type CalendarClient = NonNullable<
	Options<CalendarOperationsListCalendarsData>["client"]
>;

export const registerCalendarTools = (
	server: McpServer,
	client: CalendarClient,
): void => {
	server.registerTool(
		"list_calendars",
		{
			description: "List your calendar collections.",
			annotations: READ_ONLY,
		},
		async () =>
			asApiJson(
				await calendarOperationsListCalendars({
					client,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"create_calendar",
		{
			description: "Create a calendar collection.",
			annotations: EXTERNAL_WRITE,
			inputSchema: CreateCalendarInputSchema.shape,
		},
		async (body) =>
			asApiJson(
				await calendarOperationsCreateCalendar({
					client,
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"get_calendar",
		{
			description: "Get a calendar collection.",
			annotations: READ_ONLY,
			inputSchema: { calendarId },
		},
		async ({ calendarId }) =>
			asApiJson(
				await calendarDetailOperationsGetCalendar({
					client,
					path: { calendarId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"update_calendar",
		{
			description: "Change a calendar collection.",
			annotations: WRITE,
			inputSchema: { calendarId, ...UpdateCalendarInputSchema.shape },
		},
		async ({ calendarId, ...body }) =>
			asApiJson(
				await calendarDetailOperationsUpdateCalendar({
					client,
					path: { calendarId },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"delete_calendar",
		{
			description: "Delete a calendar and every event or task in it.",
			annotations: DESTRUCTIVE,
			inputSchema: { calendarId },
		},
		async ({ calendarId }) =>
			asApiJson(
				await calendarDetailOperationsDeleteCalendar({
					client,
					path: { calendarId },
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"get_calendar_feed",
		{
			description: "Read whether a calendar has a feed address.",
			annotations: READ_ONLY,
			inputSchema: { calendarId },
		},
		async ({ calendarId }) =>
			asApiJson(
				await calendarDetailOperationsGetCalendarFeed({
					client,
					path: { calendarId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"put_calendar_feed",
		{
			description:
				"Mint or rotate a calendar feed address and return its secret token.",
			annotations: DESTRUCTIVE,
			inputSchema: { calendarId },
		},
		async ({ calendarId }) =>
			asApiJson(
				await calendarDetailOperationsPutCalendarFeed({
					client,
					path: { calendarId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"revoke_calendar_feed",
		{
			description: "Revoke a calendar feed address.",
			annotations: DESTRUCTIVE,
			inputSchema: { calendarId },
		},
		async ({ calendarId }) =>
			asApiJson(
				await calendarDetailOperationsRevokeCalendarFeed({
					client,
					path: { calendarId },
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"list_calendar_events",
		{
			description: "List expanded event occurrences in a time window.",
			annotations: READ_ONLY,
			inputSchema: {
				from,
				to,
				calendarId: calendarIds,
				calendarObjectId: calendarObjectId.optional(),
			},
		},
		async (query) =>
			asApiJson(
				await calendarEventOperationsListCalendarEvents({
					client,
					query,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"create_calendar_event",
		{
			description: "Create an event and queue invitations for its guests.",
			annotations: EXTERNAL_WRITE,
			inputSchema: CreateCalendarEventInputSchema.shape,
		},
		async (body) =>
			asApiJson(
				await calendarEventOperationsCreateCalendarEvent({
					client,
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"get_calendar_event",
		{
			description: "Get one stored event.",
			annotations: READ_ONLY,
			inputSchema: {
				calendarObjectId,
				calendarId: calendarId.optional(),
			},
		},
		async ({ calendarObjectId, calendarId }) =>
			asApiJson(
				await calendarEventDetailOperationsGetCalendarEvent({
					client,
					path: { calendarObjectId },
					query: { calendarId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"update_calendar_event",
		{
			description:
				"Change an event and queue scheduling updates for its guests.",
			annotations: EXTERNAL_WRITE,
			inputSchema: {
				calendarObjectId,
				calendarId,
				scope,
				recurrenceId,
				ifMatch,
				...UpdateCalendarEventInputSchema.shape,
			},
		},
		async ({
			calendarObjectId,
			calendarId,
			scope,
			recurrenceId,
			ifMatch,
			...body
		}) =>
			asApiJson(
				await calendarEventDetailOperationsUpdateCalendarEvent({
					client,
					path: { calendarObjectId },
					query: { calendarId, scope, recurrenceId },
					headers: { "If-Match": ifMatch },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"delete_calendar_event",
		{
			description: "Delete event occurrences and queue guest cancellations.",
			annotations: EXTERNAL_DESTRUCTIVE,
			inputSchema: {
				calendarObjectId,
				calendarId,
				scope,
				recurrenceId,
				ifMatch,
			},
		},
		async ({ calendarObjectId, calendarId, scope, recurrenceId, ifMatch }) =>
			asApiJson(
				await calendarEventDetailOperationsDeleteCalendarEvent({
					client,
					path: { calendarObjectId },
					query: { calendarId, scope, recurrenceId },
					headers: { "If-Match": ifMatch },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"list_calendar_free_busy",
		{
			description: "List busy spans across your calendars in a time window.",
			annotations: READ_ONLY,
			inputSchema: { from, to },
		},
		async (query) =>
			asApiJson(
				await calendarFreeBusyOperationsListCalendarFreeBusy({
					client,
					query,
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"list_calendar_tasks",
		{
			description: "List tasks due in a time window.",
			annotations: READ_ONLY,
			inputSchema: { from, to, calendarId: calendarIds },
		},
		async (query) =>
			asApiJson(
				await calendarTaskOperationsListCalendarTasks({
					client,
					query,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"create_calendar_task",
		{
			description: "Create a task.",
			annotations: WRITE,
			inputSchema: CreateCalendarTaskInputSchema.shape,
		},
		async (body) =>
			asApiJson(
				await calendarTaskOperationsCreateCalendarTask({
					client,
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"get_calendar_task",
		{
			description: "Get one stored task.",
			annotations: READ_ONLY,
			inputSchema: { calendarTaskId, calendarId: calendarId.optional() },
		},
		async ({ calendarTaskId, calendarId }) =>
			asApiJson(
				await calendarTaskDetailOperationsGetCalendarTask({
					client,
					path: { calendarTaskId },
					query: { calendarId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"update_calendar_task",
		{
			description: "Change a task.",
			annotations: WRITE,
			inputSchema: {
				calendarTaskId,
				calendarId,
				ifMatch,
				...UpdateCalendarTaskInputSchema.shape,
			},
		},
		async ({ calendarTaskId, calendarId, ifMatch, ...body }) =>
			asApiJson(
				await calendarTaskDetailOperationsUpdateCalendarTask({
					client,
					path: { calendarTaskId },
					query: { calendarId },
					headers: { "If-Match": ifMatch },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"delete_calendar_task",
		{
			description: "Delete a task.",
			annotations: DESTRUCTIVE,
			inputSchema: { calendarTaskId, calendarId, ifMatch },
		},
		async ({ calendarTaskId, calendarId, ifMatch }) =>
			asApiJson(
				await calendarTaskDetailOperationsDeleteCalendarTask({
					client,
					path: { calendarTaskId },
					query: { calendarId },
					headers: { "If-Match": ifMatch },
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"list_calendar_suggestions",
		{
			description: "List calendar suggestions in one state, newest first.",
			annotations: READ_ONLY,
			inputSchema: {
				state: CalendarSuggestionStateSchema,
				continuationToken,
			},
		},
		async (query) =>
			asApiJson(
				await calendarSuggestionOperationsListCalendarSuggestions({
					client,
					query,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"list_message_calendar_suggestions",
		{
			description: "List every calendar suggestion found in one message.",
			annotations: READ_ONLY,
			inputSchema: { messageId },
		},
		async ({ messageId }) =>
			asApiJson(
				await messageCalendarSuggestionOperationsListMessageCalendarSuggestions(
					{
						client,
						path: { messageId },
						throwOnError: true,
					},
				),
			),
	);
	server.registerTool(
		"accept_calendar_suggestion",
		{
			description: "Accept or tentatively accept a calendar suggestion.",
			annotations: WRITE,
			inputSchema: {
				suggestionId,
				...AcceptCalendarSuggestionInputSchema.shape,
			},
		},
		async ({ suggestionId, ...body }) =>
			asApiJson(
				await calendarSuggestionActionOperationsAcceptCalendarSuggestion({
					client,
					path: { suggestionId },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"decline_calendar_suggestion",
		{
			description: "Decline a calendar suggestion.",
			annotations: WRITE,
			inputSchema: { suggestionId },
		},
		async ({ suggestionId }) =>
			asApiJson(
				await calendarSuggestionActionOperationsDeclineCalendarSuggestion({
					client,
					path: { suggestionId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"dismiss_calendar_suggestion",
		{
			description:
				"Dismiss a calendar suggestion and optionally mute its sender.",
			annotations: WRITE,
			inputSchema: {
				suggestionId,
				...DismissCalendarSuggestionInputSchema.shape,
			},
		},
		async ({ suggestionId, ...body }) =>
			asApiJson(
				await calendarSuggestionActionOperationsDismissCalendarSuggestion({
					client,
					path: { suggestionId },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"reopen_calendar_suggestion",
		{
			description: "Return an answered or dismissed suggestion to pending.",
			annotations: WRITE,
			inputSchema: { suggestionId },
		},
		async ({ suggestionId }) =>
			asApiJson(
				await calendarSuggestionActionOperationsReopenCalendarSuggestion({
					client,
					path: { suggestionId },
					throwOnError: true,
				}),
			),
	);
};
