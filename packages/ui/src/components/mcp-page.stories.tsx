import type { Meta, StoryObj } from "@storybook/react-vite";
import { McpPage } from "./mcp-page.js";

const meta: Meta<typeof McpPage> = {
	title: "Playground/Proposed/MCP/McpPage",
	tags: ["proposed"],
	component: McpPage,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof McpPage>;

export const WithIntro: Story = {
	args: {
		heading: "Connected apps",
		intro: "These apps can use your mail.",
		children: <p className="text-sm text-fg">Page content</p>,
	},
};

export const HeadingOnly: Story = {
	args: {
		heading: "Something went wrong",
		children: <p className="text-sm text-fg">Page content</p>,
	},
};
