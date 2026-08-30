import {
	type CalendarColorId,
	type CalendarEventData,
	type Density,
	NavSidebar,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CalendarShell, CalendarShellProvider } from "./CalendarShell";
import { CalendarWorkspace } from "./CalendarWorkspace";

/**
 * The chrome the calendar shares with mail, at the two widths that change what
 * the reader can reach.
 *
 * Above the boundary the nav is a pane and the calendar sits beside it. Below
 * it the nav is a slide-over, nothing opens a slide-over on its own, and the
 * calendar is the whole width of the app — so the way back to the mail has to be
 * a control the calendar itself carries. Losing it strands a reader inside their
 * diary with no route out, which is what these two stories hold the shell to.
 */

const TIME_ZONE = "Europe/Amsterdam";
const DATE = "2026-06-10";
const NOW = `${DATE}T09:30:00+02:00`;
const CALENDAR = "cal_work";

const colorByCalendarId: Record<string, CalendarColorId> = {
	[CALENDAR]: "cal-1",
};

const roadmap: CalendarEventData = {
	id: "roadmap",
	calendarId: CALENDAR,
	title: "Roadmap review",
	start: `${DATE}T10:00:00+02:00`,
	end: `${DATE}T11:30:00+02:00`,
	allDay: false,
	location: "",
	notes: "",
	attendees: [],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: TIME_ZONE,
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

const nav = (
	<NavSidebar
		accounts={[
			{
				id: "acct_work",
				label: "Work",
				email: "work@example.invalid",
				mailboxes: [
					{ id: "mb_inbox", name: "Inbox", role: "inbox", unseen: 3 },
					{ id: "mb_sent", name: "Sent", role: "sent" },
				],
			},
		]}
		selectedNavId="calendar"
		calendarNav="shown"
	/>
);

const reading = (
	<div className="flex h-full items-center justify-center bg-surface text-sm text-fg-muted">
		Nothing open.
	</div>
);

/** The layout publishes the chrome; a story holds the slide-over's own state. */
function Shell({
	width,
	isSinglePane,
}: {
	/** The shell measures its own box, so the story gives it one. */
	width: number;
	isSinglePane: boolean;
}) {
	const [navOpen, setNavOpen] = useState(false);
	const [density, setDensity] = useState<Density>("comfortable");
	return (
		<div style={{ width }} className="bg-canvas">
			<CalendarShellProvider
				chrome={{
					isSinglePane,
					isLoading: false,
					nav,
					navOpen,
					onOpenNav: () => setNavOpen(true),
					onCloseNav: () => setNavOpen(false),
				}}
			>
				<CalendarShell
					hasOpenEvent={false}
					reading={reading}
					workspace={
						<CalendarWorkspace
							view="week"
							date={DATE}
							events={[roadmap]}
							colorByCalendarId={colorByCalendarId}
							agenda={null}
							density={density}
							selectedEventId=""
							timeZone={TIME_ZONE}
							now={NOW}
							onChangeView={() => undefined}
							onToday={() => undefined}
							onStep={() => undefined}
							onChangeDensity={setDensity}
							onSelectEvent={() => undefined}
							onPickSlot={() => undefined}
						/>
					}
				/>
			</CalendarShellProvider>
		</div>
	);
}

const meta: Meta<typeof Shell> = {
	title: "App/Calendar/Shell",
	component: Shell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Shell>;

/**
 * Below the boundary. The nav is a slide-over with nothing else to open it, so
 * the calendar's own header carries the control — and pressing it is the whole
 * of the way back to the mail.
 */
export const NavAsSlideOver: Story = {
	args: { width: 900, isSinglePane: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("button", { name: /Inbox/ })).toBeNull();

		const folders = await canvas.findByRole("button", {
			name: "Open folders",
		});
		await userEvent.click(folders);

		await expect(
			await canvas.findByRole("button", { name: /Inbox/ }),
		).toBeVisible();
	},
};

/**
 * Above it. The nav is a column of its own, so a second control that opened it
 * would be a button for something already on screen.
 */
export const NavAsPane: Story = {
	args: { width: 1440, isSinglePane: false },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: /Inbox/ }),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", { name: "Open folders" }),
		).toBeNull();
	},
};
