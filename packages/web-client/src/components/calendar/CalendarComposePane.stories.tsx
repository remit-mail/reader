import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarComposePane } from "./CalendarComposePane";

/**
 * `/calendar/{view}/{date}/new`. The address is real and the editor is not
 * written yet, so the pane says which it is and offers the way back — the one
 * thing worse than an unfinished surface is one that looks finished and does
 * nothing.
 */
const meta: Meta<typeof CalendarComposePane> = {
	title: "App/Calendar/Compose pane",
	component: CalendarComposePane,
	parameters: { layout: "fullscreen" },
	args: { onClose: () => {} },
	render: (args) => (
		<div className="h-dvh max-w-xl border-l border-line bg-canvas">
			<CalendarComposePane {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof CalendarComposePane>;

export const NotBuiltYet: Story = {};
