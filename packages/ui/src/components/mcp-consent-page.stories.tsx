import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { McpConsentPage } from "./mcp-consent-page.js";
import { mcpPermissionsFixture } from "./mcp-fixtures.js";

const meta: Meta<typeof McpConsentPage> = {
	title: "Playground/Proposed/MCP/McpConsentPage",
	tags: ["proposed"],
	component: McpConsentPage,
	parameters: { layout: "fullscreen" },
	args: { clientName: "Claude", oauthQuery: "client_id=abc&sig=xyz" },
};
export default meta;

type Story = StoryObj<typeof McpConsentPage>;

export const ReadAndRules: Story = {
	args: { permissions: mcpPermissionsFixture },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Read your mail")).toBeVisible();
		await expect(
			canvas.getByText("Create and change folders and filters"),
		).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Allow" })).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Deny" })).toBeVisible();
	},
};

export const ReadOnly: Story = {
	args: { permissions: mcpPermissionsFixture.slice(0, 1) },
};

export const LongClientName: Story = {
	args: {
		clientName: "A very long assistant name registered by a desktop client",
		permissions: mcpPermissionsFixture,
	},
};
