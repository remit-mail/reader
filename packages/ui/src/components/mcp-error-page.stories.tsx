import type { Meta, StoryObj } from "@storybook/react-vite";
import { McpErrorPage } from "./mcp-error-page.js";
import { mcpErrorFixture } from "./mcp-fixtures.js";

const meta: Meta<typeof McpErrorPage> = {
	title: "Playground/Proposed/MCP/McpErrorPage",
	tags: ["proposed"],
	component: McpErrorPage,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof McpErrorPage>;

export const ExpiredSignIn: Story = {
	args: { heading: "Sign-in expired", error: mcpErrorFixture },
};
