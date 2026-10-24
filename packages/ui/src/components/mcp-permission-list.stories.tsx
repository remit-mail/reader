import type { Meta, StoryObj } from "@storybook/react-vite";
import { mcpPermissionsFixture } from "./mcp-fixtures.js";
import { McpPermissionList } from "./mcp-permission-list.js";

const meta: Meta<typeof McpPermissionList> = {
	title: "MCP/McpPermissionList",
	component: McpPermissionList,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof McpPermissionList>;

export const AllScopes: Story = {
	args: { permissions: mcpPermissionsFixture },
};

export const ReadOnly: Story = {
	args: { permissions: mcpPermissionsFixture.slice(0, 1) },
};
