import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { McpErrorNotice } from "./mcp-error-notice.js";
import { mcpErrorFixture } from "./mcp-fixtures.js";

const meta: Meta<typeof McpErrorNotice> = {
	title: "Playground/Proposed/MCP/McpErrorNotice",
	tags: ["proposed"],
	component: McpErrorNotice,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof McpErrorNotice>;

export const StatesTheFix: Story = {
	args: { error: mcpErrorFixture },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			mcpErrorFixture.fix,
		);
		await expect(
			canvas.getByRole("link", { name: "Report an issue" }),
		).toHaveAttribute("href", mcpErrorFixture.reportUrl);
	},
};
