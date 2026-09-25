import { Card, CardBody } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { CalendarSubscriptionStatus } from "./CalendarSubscriptionStatus";

/**
 * Settings › Calendars: a calendar subscribed to a feed (#1261). The address is
 * never drawn in full, since for Google it is the whole credential; its host
 * is enough to recognise it.
 */
const meta: Meta<typeof CalendarSubscriptionStatus> = {
	title: "Playground/Shipped/Settings/Calendars/Subscribed calendar",
	component: CalendarSubscriptionStatus,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<Card className="max-w-xl">
				<CardBody>
					<Story />
				</CardBody>
			</Card>
		),
	],
	args: {
		calendarName: "Harbour rota",
		subscriptionUrl:
			"https://calendar.google.com/calendar/ical/harbour%40example.com/private-5f1c0ffee/basic.ics",
		enabled: true,
		fetchedAt: Date.parse("2026-09-25T08:15:00Z"),
		error: "",
		isBusy: false,
		actionError: undefined,
		onSetEnabled: fn(),
	},
};
export default meta;

type Story = StoryObj<typeof CalendarSubscriptionStatus>;

/** Refreshing on schedule. Only the host is named. */
export const Live: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/Read-only, from calendar\.google\.com/),
		).toBeVisible();
		await expect(canvasElement.textContent).not.toContain("private-5f1c0ffee");
	},
};

/** The last refresh failed. The events already stored stay. */
export const Failing: Story = {
	args: { error: "the feed answered HTTP 404" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"the feed answered HTTP 404",
		);
	},
};

/** Updates paused. Nothing was removed. */
export const Paused: Story = {
	args: { enabled: false },
};

/** Paused, on the dark theme. */
export const PausedDark: Story = {
	name: "Paused (dark)",
	parameters: { theme: "dark" },
	args: { enabled: false, error: "the feed answered HTTP 410" },
};

/** Never fetched successfully yet. */
export const NeverFetched: Story = {
	args: { fetchedAt: 0 },
};
