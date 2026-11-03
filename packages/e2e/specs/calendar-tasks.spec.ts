/**
 * Tasks over the public API (reader#1508): every account holds a task list
 * beside its default calendar, and a task is created, ticked, read back in its
 * due window and deleted there.
 */
import { ApiClient } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const WINDOW = {
	from: "2027-05-03T00:00:00+00:00",
	to: "2027-05-10T00:00:00+00:00",
};

test.describe("Tasks", () => {
	let run: IsolatedRun;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("Tasks");
	});

	test("an account gets a task list, and a task round-trips through it (FF2.7, FF2.8, FF2.9)", async () => {
		const api = new ApiClient({
			email: run.email,
			password: run.password,
			token: run.token,
		});

		const lists = (await api.listCalendars()).filter(
			(collection) => collection.componentSet === "VtodoOnly",
		);
		expect(lists).toHaveLength(1);

		const created = await api.createCalendarTask({
			summary: `Task e2e ${Date.now()}`,
			due: "2027-05-05",
			allDay: true,
		});
		expect(created.calendarId).toBe(lists[0]?.calendarId);
		expect(created.completed).toBe(false);

		const done = await api.updateCalendarTask(created, { completed: true });
		expect(done.completed).toBe(true);

		const listed = await api.listCalendarTasks(WINDOW.from, WINDOW.to);
		expect(listed.items.map((task) => task.calendarTaskId)).toContain(
			created.calendarTaskId,
		);
		expect(
			(
				await api.listCalendarTasks(
					"2027-05-10T00:00:00+00:00",
					"2027-05-17T00:00:00+00:00",
				)
			).items,
		).toEqual([]);

		const removed = await api.deleteCalendarTask(created);
		expect(removed.status).toBe(204);
		expect(
			(await api.listCalendarTasks(WINDOW.from, WINDOW.to)).items.map(
				(task) => task.calendarTaskId,
			),
		).not.toContain(created.calendarTaskId);
	});
});
