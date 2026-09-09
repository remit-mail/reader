import type { CalendarSlotPick } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { calendars, STORY_DATE, STORY_WEEK } from "./calendar-story-fixtures";
import {
	type CalendarServer,
	CalendarStory,
	json,
} from "./calendar-story-server";
import { WriteCalendarEvent } from "./WriteCalendarEvent";

/**
 * Writing a new event, at `/calendar/{view}/{date}/new`.
 *
 * The draft it opens on comes from two places and neither is a prop: the day is
 * the address's, and the hours are the slot the reader dragged out of the grid,
 * handed over by the click that opened the form. The slot is deliberately not in
 * the URL — a half-written event is not a fact about where the reader is — so
 * the composer opened any other way starts on the day the calendar is showing,
 * which is the second story here.
 */

const server: CalendarServer = (request) => {
	const url = new URL(request.url);
	if (url.pathname.endsWith("/calendars")) return json({ items: calendars });
	return json({ items: [] });
};

const slot: CalendarSlotPick = {
	date: "2026-06-11",
	startTime: "14:00",
	endTime: "15:00",
	allDay: false,
};

function Composer({ pick }: { pick?: CalendarSlotPick }) {
	return (
		<div className="h-dvh max-w-2xl border-l border-line bg-canvas">
			<CalendarStory
				entry={`${STORY_WEEK}/new`}
				server={server}
				pick={pick}
				pane={<WriteCalendarEvent onClose={() => undefined} />}
			/>
		</div>
	);
}

const meta: Meta<typeof Composer> = {
	title: "App/Calendar/Write event",
	component: Composer,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Composer>;

/**
 * Dragged out of Thursday afternoon. The hours the reader picked are already in
 * the form, so the gesture is the answer rather than a hint they now retype.
 */
export const SeededFromASlotPick: Story = {
	args: { pick: slot },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByLabelText("Date")).toHaveValue(slot.date);
		await expect(canvas.getByLabelText("Start time")).toHaveValue(
			slot.startTime,
		);
		await expect(canvas.getByLabelText("End time")).toHaveValue(slot.endTime);
		await expect(canvas.getByLabelText("Title")).toHaveValue("");
	},
};

/**
 * Opened with no slot behind it. It starts on the day the calendar is showing,
 * and on the calendar the listing provisioned — a reader who has written nothing
 * yet should not have to choose where it goes before they can type.
 */
export const Empty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByLabelText("Date")).toHaveValue(STORY_DATE);
		await expect(canvas.getByLabelText("Title")).toHaveValue("");
		await expect(
			await canvas.findByRole("radio", { name: "Northwind" }),
		).toBeChecked();
	},
};
