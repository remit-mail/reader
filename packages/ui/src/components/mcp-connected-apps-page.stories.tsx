import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { McpConnectedAppsPage } from "./mcp-connected-apps-page.js";
import { mcpErrorFixture, mcpPermissionsFixture } from "./mcp-fixtures.js";

const meta: Meta<typeof McpConnectedAppsPage> = {
	title: "Playground/Proposed/MCP/McpConnectedAppsPage",
	tags: ["proposed"],
	component: McpConnectedAppsPage,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof McpConnectedAppsPage>;

const apps = [
	{
		clientId: "client-claude-ai",
		name: "Claude",
		permissions: mcpPermissionsFixture,
		connectedOn: "12 October 2026",
	},
	{
		clientId: "client-claude-code",
		name: "Claude Code",
		permissions: mcpPermissionsFixture.slice(0, 1),
		connectedOn: "20 October 2026",
	},
];

export const TwoApps: Story = {
	args: { apps },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Disconnect Claude Code" }),
		).toBeVisible();
	},
};

export const JustDisconnected: Story = {
	args: { apps: apps.slice(1), disconnected: "Claude" },
};

export const NoApps: Story = {
	args: { apps: [] },
};

export const DisconnectFailed: Story = {
	args: {
		apps,
		error: {
			message: "Disconnecting Claude failed.",
			fix: "Reload the page and try again.",
			reportUrl: mcpErrorFixture.reportUrl,
		},
	},
};
