import type { Density } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AgendaView } from "./AgendaView";
import {
	calendars,
	fortnight,
	instancesWithin,
	STORY_DATE,
} from "./calendar-story-fixtures";
import {
	type CalendarServer,
	CalendarStory,
	json,
	never,
} from "./calendar-story-server";

/**
 * The agenda bound to the address, which is the only way it exists.
 *
 * It holds no days of its own: the run comes from the day the URL names, the
 * weeks are fetched one at a time as the reader scrolls, and every move it makes
 * leaves as a new address. So the states worth a story are the ones the reader
 * cannot tell apart by looking — a fortnight with two things in it, a fortnight
 * nobody has heard back about, and a fortnight the server refused. Drawn wrong,
 * the last two are the first one, and the reader plans a clear week they do not
 * have.
 */

const AGENDA = `/calendar/agenda/${STORY_DATE}`;

const answering = (events: (url: URL) => Response | Promise<Response>) =>
	((request: Request) => {
		const url = new URL(request.url);
		if (url.pathname.endsWith("/calendars")) return json({ items: calendars });
		if (url.pathname.endsWith("/calendar-events")) return events(url);
		return json({ items: [] });
	}) satisfies CalendarServer;

function Agenda({
	density,
	server,
}: {
	density: Density;
	server: CalendarServer;
}) {
	return (
		<div className="flex h-dvh flex-col bg-canvas">
			<CalendarStory
				entry={AGENDA}
				server={server}
				pane={<AgendaView density={density} onPickSlot={() => undefined} />}
			/>
		</div>
	);
}

const meta: Meta<typeof Agenda> = {
	title: "App/Calendar/Agenda view",
	component: Agenda,
	parameters: { layout: "fullscreen" },
	args: {
		density: "comfortable",
		server: answering((url) =>
			json({ items: instancesWithin(url, fortnight) }),
		),
	},
};
export default meta;

type Story = StoryObj<typeof Agenda>;

/** The weeks around the day the address names, drawn from what the server sent. */
export const Populated: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Roadmap review")).toBeVisible();
		await expect(canvas.getByText("Standup")).toBeVisible();
	},
};

/**
 * The weeks are still out. Every day keeps the row it will occupy, so nothing
 * jumps when the answers land — and, which matters more, an unanswered day says
 * so rather than drawing as a day with nothing booked on it.
 */
export const LoadingWeeks: Story = {
	args: { server: answering(never) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId(`agenda-day-pending-${STORY_DATE}`),
		).toBeVisible();
		await expect(canvas.queryByText("Roadmap review")).toBeNull();
	},
};

/**
 * The read was refused. This is the state an empty strip must never be confused
 * with: a fortnight drawn blank because the request failed reads as a fortnight
 * with nothing in it, and the reader gives the time away.
 */
export const RefusedRead: Story = {
	args: {
		server: answering(() =>
			json({ message: "The window has to be shorter than a year." }, 400),
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Couldn't load these days"),
		).toBeVisible();
		await expect(canvas.queryByText("Roadmap review")).toBeNull();
	},
};
