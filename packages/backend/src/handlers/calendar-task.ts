import type {
	CalendarTaskResponse,
	CreateCalendarTaskInput,
	UpdateCalendarTaskInput,
} from "@remit/api-openapi-types";
import {
	buildTaskCalendar,
	type CalendarTaskFields,
	listTasksInWindow,
	prepareCalendarTask,
	updateTaskCalendar,
} from "@remit/calendar-service";
import type {
	CalendarCollectionItem,
	CalendarTaskItem,
} from "@remit/data-ports";
import { base36uuid } from "@remit/data-ports/id";
import { CalendarComponentSet } from "@remit/domain-enums";
import type {
	CalendarTaskDetailOperationIds,
	CalendarTaskOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
import {
	type CalendarDeps,
	type CalendarOutcome,
	calendarDepsOf,
	listCalendarsFor,
	notFound,
	refuseCalendar,
} from "./calendar.js";
import {
	answerRefusal,
	collectionsForListing,
	etagMatches,
	readIfMatch,
	readWindow,
} from "./calendar-event.js";

const toTaskResponse = (task: CalendarTaskItem): CalendarTaskResponse => ({
	calendarTaskId: task.calendarTaskId,
	calendarId: task.calendarId,
	resourceName: task.resourceName,
	icalUid: task.icalUid,
	icalData: task.icalData,
	etag: task.etag,
	summary: task.summary,
	description: task.description,
	due: task.due,
	dueAt: task.dueAt,
	allDay: task.allDay,
	completed: task.completed,
	createdAt: task.createdAt,
	updatedAt: task.updatedAt,
});

const isTaskCollection = (collection: CalendarCollectionItem): boolean =>
	collection.componentSet === CalendarComponentSet.VtodoOnly;

/** The task collection a write goes to: the one named, or the account's own. */
export const taskCalendarFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<CalendarCollectionItem>> => {
	const held = await listCalendarsFor(deps, accountConfigId);
	if (calendarId === "") {
		const own = held.find(isTaskCollection);
		if (!own)
			throw new Error("listCalendarsFor provisioned no task collection");
		return { ok: true, value: own };
	}
	const named = held.find((collection) => collection.calendarId === calendarId);
	if (!named) {
		return refuseCalendar(
			"NotFound",
			`no calendar ${calendarId} on this account`,
		);
	}
	if (!isTaskCollection(named)) {
		return refuseCalendar(
			"NotATaskCalendar",
			`"${named.displayName}" holds events, so a task cannot be written into it`,
		);
	}
	return { ok: true, value: named };
};

const pickTaskUpdate = (
	body: Partial<UpdateCalendarTaskInput>,
): Partial<CalendarTaskFields> => {
	const patch: Partial<CalendarTaskFields> = {};
	for (const field of [
		"summary",
		"description",
		"due",
		"allDay",
		"timeZone",
		"completed",
	] as const) {
		if (!Object.hasOwn(body, field)) continue;
		Object.assign(patch, { [field]: body[field] });
	}
	return patch;
};

export const createCalendarTaskFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	input: CreateCalendarTaskInput,
	newId: () => string = base36uuid,
	now: Date = new Date(),
): Promise<CalendarOutcome<CalendarTaskItem>> => {
	const collection = await taskCalendarFor(
		deps,
		accountConfigId,
		input.calendarId ?? "",
	);
	if (!collection.ok) return collection;
	const id = newId();
	const built = buildTaskCalendar(
		{
			summary: input.summary,
			description: input.description ?? "",
			due: input.due,
			allDay: input.allDay ?? false,
			timeZone: input.timeZone ?? "",
			completed: false,
		},
		`${id}@reader.remit`,
		now,
	);
	if (!built.ok) return built;
	const row = await prepareCalendarTask(
		collection.value,
		`${id}.ics`,
		built.value,
	);
	if (!row.ok) return row;
	return { ok: true, value: await deps.calendarTask.put(row.value) };
};

interface TaskRequest {
	calendarId: string;
	calendarTaskId: string;
	ifMatch: string | undefined;
}

const resolveTask = async (
	deps: CalendarDeps,
	accountConfigId: string,
	request: TaskRequest,
): Promise<
	CalendarOutcome<{
		collection: CalendarCollectionItem;
		task: CalendarTaskItem;
	}>
> => {
	const collection = await taskCalendarFor(
		deps,
		accountConfigId,
		request.calendarId,
	);
	if (!collection.ok) return collection;
	const task = await deps.calendarTask.find(
		collection.value.calendarId,
		request.calendarTaskId,
	);
	if (!task) {
		return refuseCalendar(
			"NotFound",
			`no task ${request.calendarTaskId} in this calendar`,
		);
	}
	if (!etagMatches(request.ifMatch, task.etag)) {
		return refuseCalendar(
			"EtagMismatch",
			"this task has been written since you read it — read it again and reapply the change",
		);
	}
	return { ok: true, value: { collection: collection.value, task } };
};

export const updateCalendarTaskFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	request: TaskRequest,
	patch: Partial<CalendarTaskFields>,
	now: Date = new Date(),
): Promise<CalendarOutcome<CalendarTaskItem>> => {
	const resolved = await resolveTask(deps, accountConfigId, request);
	if (!resolved.ok) return resolved;
	const { collection, task } = resolved.value;
	const rewritten = await updateTaskCalendar(
		task.icalData,
		patch,
		collection.timezone,
		now,
	);
	if (!rewritten.ok) return rewritten;
	const row = await prepareCalendarTask(
		collection,
		task.resourceName,
		rewritten.value,
	);
	if (!row.ok) return row;
	return { ok: true, value: await deps.calendarTask.put(row.value) };
};

const taskRequestOf = (
	context: Parameters<OperationHandler>[0],
): TaskRequest => {
	const { calendarTaskId } = context.request.params as {
		calendarTaskId: string;
	};
	const { calendarId } = context.request.query as { calendarId?: string };
	return {
		calendarId: calendarId ?? "",
		calendarTaskId,
		ifMatch: readIfMatch(context),
	};
};

const readCalendarIds = (value: unknown): string[] => {
	if (typeof value === "string") return value === "" ? [] : [value];
	if (Array.isArray(value)) return value.filter((id) => typeof id === "string");
	return [];
};

export const CalendarTaskOperations: Record<
	CalendarTaskOperationIds,
	OperationHandler<CalendarTaskOperationIds>
> = {
	CalendarTaskOperations_listCalendarTasks: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const query = context.request.query as {
			from?: string;
			to?: string;
			calendarId?: string | string[];
		};
		const window = readWindow(query.from, query.to);
		if (!window.ok) return answerRefusal(window.error);
		const deps = calendarDepsOf(ctx.client);
		const collections = await collectionsForListing(
			deps,
			accountConfigId,
			readCalendarIds(query.calendarId),
			CalendarComponentSet.VtodoOnly,
		);
		if (!collections.ok) return answerRefusal(collections.error);
		const tasks = await listTasksInWindow(
			deps.calendarTask,
			collections.value.filter(isTaskCollection),
			window.value,
		);
		return { items: tasks.map(toTaskResponse) };
	},

	CalendarTaskOperations_createCalendarTask: async (
		context,
		ctx: HandlerContext,
	) => {
		const created = await createCalendarTaskFor(
			calendarDepsOf(ctx.client),
			ctx.identity.accountConfigId,
			context.request.requestBody as CreateCalendarTaskInput,
		);
		if (!created.ok) return answerRefusal(created.error);
		return toTaskResponse(created.value);
	},
};

export const CalendarTaskDetailOperations: Record<
	CalendarTaskDetailOperationIds,
	OperationHandler<CalendarTaskDetailOperationIds>
> = {
	CalendarTaskDetailOperations_getCalendarTask: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const deps = calendarDepsOf(ctx.client);
		const request = taskRequestOf(context);
		if (request.calendarId === "") {
			for (const collection of (
				await listCalendarsFor(deps, accountConfigId)
			).filter(isTaskCollection)) {
				const task = await deps.calendarTask.find(
					collection.calendarId,
					request.calendarTaskId,
				);
				if (task) return toTaskResponse(task);
			}
			return notFound(`no task ${request.calendarTaskId} on this account`);
		}
		const resolved = await resolveTask(deps, accountConfigId, {
			...request,
			ifMatch: undefined,
		});
		if (!resolved.ok) return answerRefusal(resolved.error);
		return toTaskResponse(resolved.value.task);
	},

	CalendarTaskDetailOperations_updateCalendarTask: async (
		context,
		ctx: HandlerContext,
	) => {
		const updated = await updateCalendarTaskFor(
			calendarDepsOf(ctx.client),
			ctx.identity.accountConfigId,
			taskRequestOf(context),
			pickTaskUpdate(
				context.request.requestBody as Partial<UpdateCalendarTaskInput>,
			),
		);
		if (!updated.ok) return answerRefusal(updated.error);
		return toTaskResponse(updated.value);
	},

	CalendarTaskDetailOperations_deleteCalendarTask: async (
		context,
		ctx: HandlerContext,
	) => {
		const deps = calendarDepsOf(ctx.client);
		const resolved = await resolveTask(
			deps,
			ctx.identity.accountConfigId,
			taskRequestOf(context),
		);
		if (!resolved.ok) return answerRefusal(resolved.error);
		await deps.calendarTask.delete(
			resolved.value.collection.calendarId,
			resolved.value.task.calendarTaskId,
		);
		return { statusCode: 204 };
	},
};
