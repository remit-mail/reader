import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { instancesWithin } from "@/mocks/story-frame/calendar-window";
import { useOpenCalendarEvent } from "@/routing";
import {
	calendars,
	fortnight,
	ROADMAP_OBJECT,
	roadmapResource,
	STANDUP_OBJECT,
	STANDUP_RECURRENCE,
	STORY_WEEK,
	standupResource,
} from "./calendar-story-fixtures";
import {
	type CalendarServer,
	CalendarStory,
	json,
} from "./calendar-story-server";
import { OpenCalendarEvent } from "./OpenCalendarEvent";

/**
 * The event the address names, and everything a reader can do to it.
 *
 * The pane is reached at two addresses — a resource on its own, and one
 * occurrence under a series — and which one it is decides whether an edit has a
 * question to answer first. That question is the state worth holding: it is
 * asked here and nowhere else, and asking it late, on the way out, would mean
 * the reader has already typed the change before being told what it reaches.
 */

const answering = (
	fail?: (request: Request) => Response | undefined,
): CalendarServer => {
	return (request) => {
		const refusal = fail?.(request);
		if (refusal) return refusal;
		const url = new URL(request.url);
		if (url.pathname.endsWith("/calendars")) return json({ items: calendars });
		if (url.pathname.endsWith("/calendar-events"))
			return json({ items: instancesWithin(url, fortnight) });
		if (url.pathname.includes(STANDUP_OBJECT)) return json(standupResource);
		if (url.pathname.includes(ROADMAP_OBJECT)) return json(roadmapResource);
		return json({ items: [] });
	};
};

/** The pane with its props read off the address, as the app's routes hand them. */
function FromAddress() {
	const opened = useOpenCalendarEvent();
	return (
		<OpenCalendarEvent
			calendarObjectId={opened?.calendarObjectId ?? ""}
			recurrenceId={opened?.recurrenceId}
		/>
	);
}

function Opened({
	calendarObjectId,
	recurrenceId,
	server,
}: {
	calendarObjectId: string;
	recurrenceId?: string;
	server: CalendarServer;
}) {
	const address =
		recurrenceId === undefined
			? `${STORY_WEEK}/${calendarObjectId}`
			: `${STORY_WEEK}/${calendarObjectId}/${recurrenceId}`;
	return (
		<div className="h-dvh max-w-xl border-l border-line bg-canvas">
			<CalendarStory entry={address} server={server} pane={<FromAddress />} />
		</div>
	);
}

const meta: Meta<typeof Opened> = {
	title: "Playground/Shipped/Calendar/Open event",
	component: Opened,
	parameters: { layout: "fullscreen" },
	args: { calendarObjectId: ROADMAP_OBJECT, server: answering() },
};
export default meta;

type Story = StoryObj<typeof Opened>;

/**
 * A resource that does not recur. Edit and Delete mean the whole of it, so
 * there is nothing to ask and they open on the press.
 */
export const NonRecurring: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Roadmap review")).toBeVisible();
		// Off the stored resource rather than the listing, so this is also the
		// proof the pane read the version its writes will be conditional on.
		await expect(await canvas.findByText("Room Zuid")).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Edit" })).toBeVisible();
	},
};

/**
 * One morning of a series. Which occurrences the edit reaches changes what the
 * edit is, so it is settled while it can still be answered — and the rule is
 * read back in words, not as an RRULE.
 */
export const RecurringScopePrompt: Story = {
	args: {
		calendarObjectId: STANDUP_OBJECT,
		recurrenceId: STANDUP_RECURRENCE,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Standup")).toBeVisible();
		await expect(
			canvas.queryByText("What should the change apply to?"),
		).toBeNull();

		await userEvent.click(await canvas.findByRole("button", { name: "Edit" }));

		await expect(await canvas.findByText("Standup repeats")).toBeVisible();
		await expect(
			canvas.getByText("What should the change apply to?"),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: /This event/ }),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: /The whole series/ }),
		).toBeVisible();
	},
};

/**
 * A series opened by its plain address lands on an occurrence, so an edit asks
 * which occurrences it means exactly as it does from one.
 */
export const SeriesFromItsPlainAddress: Story = {
	args: { calendarObjectId: STANDUP_OBJECT },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("One occurrence of a repeating event"),
		).toBeVisible();
		await userEvent.click(await canvas.findByRole("button", { name: "Edit" }));
		await expect(
			await canvas.findByRole("button", { name: /The whole series/ }),
		).toBeVisible();
	},
};

/** A series that no longer falls on any day says so instead of drawing nothing. */
export const SeriesWithNoOccurrences: Story = {
	args: {
		calendarObjectId: STANDUP_OBJECT,
		server: answering((request) =>
			new URL(request.url).pathname.endsWith("/calendar-events")
				? json({ items: [] })
				: undefined,
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(
				"No occurrence in its first year or the coming year",
			),
		).toBeVisible();
	},
};

/**
 * A week the standup is not on, and the look-up for it answered by `lookUp`:
 * the listing for the one resource, and the resource read with no calendar.
 */
const lookingUp =
	(lookUp: (url: URL) => Response): CalendarServer =>
	(request) => {
		const url = new URL(request.url);
		if (url.searchParams.has("calendarObjectId")) return lookUp(url);
		if (url.pathname.endsWith("/calendar-events"))
			return json({
				items: instancesWithin(
					url,
					fortnight.filter(
						(instance) => instance.calendarObjectId !== STANDUP_OBJECT,
					),
				),
			});
		if (
			url.pathname.includes(STANDUP_OBJECT) &&
			!url.searchParams.has("calendarId")
		)
			return lookUp(url);
		return answering()(request);
	};

/** A resource none of the reader's calendars holds any more. */
export const SeriesDeleted: Story = {
	args: {
		calendarObjectId: STANDUP_OBJECT,
		server: lookingUp((url) =>
			url.pathname.endsWith("/calendar-events")
				? json({ items: [] })
				: json({ message: "no event on this account" }, 404),
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("This event was deleted"),
		).toBeVisible();
	},
};

/** A failed look-up says why and offers a report, never "not on this week". */
export const LookupFailed: Story = {
	args: {
		calendarObjectId: STANDUP_OBJECT,
		server: lookingUp(() =>
			json({ message: "The calendar store is unavailable." }, 500),
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("The event couldn't be looked up"),
		).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: "Report an issue" }),
		).toBeVisible();
	},
};

/** A session that ended during the look-up is said as such. */
export const SignedOutDuringLookup: Story = {
	args: {
		calendarObjectId: STANDUP_OBJECT,
		server: lookingUp(() => json({ message: "Session expired." }, 401)),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Your session has ended"),
		).toBeVisible();
	},
};

/**
 * Somebody replaced the event between it being read and the delete going out —
 * over CalDAV, or in another tab. Nothing was removed, and the pane says so
 * where the reader is looking rather than resolving it by winning.
 */
export const ChangedElsewhere: Story = {
	args: {
		server: answering((request) =>
			request.method === "DELETE"
				? json({ message: "The event has changed." }, 412)
				: undefined,
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Delete" }),
		);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			/changed somewhere else/,
		);
	},
};
