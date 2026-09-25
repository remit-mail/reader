import type { Meta, StoryObj } from "@storybook/react-vite";
import { BugReportButton } from "./BugReportButton";

const meta: Meta<typeof BugReportButton> = {
	title: "Playground/Shipped/Mail/Nav/BugReportButton",
	component: BugReportButton,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof BugReportButton>;

export const Default: Story = {
	render: () => (
		<div className="w-64">
			<BugReportButton />
		</div>
	),
};
