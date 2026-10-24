import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { mcpErrorFixture } from "./mcp-fixtures.js";
import { McpLoginPage } from "./mcp-login-page.js";

const meta: Meta<typeof McpLoginPage> = {
	title: "Playground/Proposed/MCP/McpLoginPage",
	tags: ["proposed"],
	component: McpLoginPage,
	parameters: { layout: "fullscreen" },
	args: { hiddenFields: { oauth_query: "client_id=abc&sig=xyz" } },
};
export default meta;

type Story = StoryObj<typeof McpLoginPage>;

export const Empty: Story = {};

export const WrongPassword: Story = {
	args: {
		email: "owner@example.com",
		error: {
			message: "Wrong email or password.",
			fix: "Check both and try again. It is the password you sign in to remit with.",
			reportUrl: mcpErrorFixture.reportUrl,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Wrong email or password.",
		);
		await expect(canvas.getByLabelText("Email")).toHaveValue(
			"owner@example.com",
		);
	},
};
