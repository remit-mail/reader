import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { CalendarViewPlaceholder } from "./CalendarViewPlaceholder";

/**
 * A zoom the ladder offers and does not draw yet.
 *
 * The route is addressable at all five zooms, so two of them land on this. What
 * it has to do is say which of the two things it is: a view that rendered
 * nothing would be indistinguishable from a month with nothing booked in it,
 * and the reader would plan around an empty screen.
 */
const meta: Meta<typeof CalendarViewPlaceholder> = {
	title: "App/Calendar/Not built yet",
	component: CalendarViewPlaceholder,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<div className="h-dvh bg-canvas">
			<CalendarViewPlaceholder {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof CalendarViewPlaceholder>;

/** It names the zoom it is waiting on, and the three that work today. */
export const Year: Story = {
	args: { view: "year" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("calendar-placeholder-year"),
		).toHaveTextContent(
			"The year grid arrives with the rest of the zoom ladder.",
		);
		await expect(canvas.getByText("Not built yet")).toBeVisible();
		await expect(
			canvas.getByText(/Week, Day and Agenda work now\./),
		).toBeVisible();
	},
};

export const Month: Story = {
	args: { view: "month" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("calendar-placeholder-month"),
		).toHaveTextContent(
			"The month grid arrives with the rest of the zoom ladder.",
		);
	},
};
