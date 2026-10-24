import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { McpDevicePage } from "./mcp-device-page.js";
import { mcpErrorFixture } from "./mcp-fixtures.js";

const meta: Meta<typeof McpDevicePage> = {
	title: "Playground/Proposed/MCP/McpDevicePage",
	tags: ["proposed"],
	component: McpDevicePage,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof McpDevicePage>;

export const EnterCode: Story = {
	args: { state: { kind: "enter", userCode: "" } },
};

export const UnknownCode: Story = {
	args: {
		state: {
			kind: "enter",
			userCode: "WXYZ-1234",
			error: {
				message: "That code is not valid or has expired.",
				fix: "Run remit mcp login again and enter the new code.",
				reportUrl: mcpErrorFixture.reportUrl,
			},
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Run remit mcp login again",
		);
		await expect(canvas.getByLabelText("Code")).toHaveValue("WXYZ-1234");
	},
};

export const Confirm: Story = {
	args: { state: { kind: "confirm", userCode: "ABCD-EFGH" } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("ABCD-EFGH")).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Approve" })).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Deny" })).toBeVisible();
	},
};

export const Approved: Story = {
	args: { state: { kind: "approved" } },
};

export const Denied: Story = {
	args: { state: { kind: "denied" } },
};
