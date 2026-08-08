import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
	type ComposeBodyMode,
	ComposeModeToggle,
} from "./compose-mode-toggle.js";

/**
 * The control that swaps the writing surface. It reads "Plain text" in both
 * states — the label names the mode it offers, and `aria-pressed` carries
 * which one is up, so the control never changes under the finger.
 */
const meta: Meta<typeof ComposeModeToggle> = {
	title: "Mail/ComposeModeToggle",
	component: ComposeModeToggle,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ComposeModeToggle>;

const Harness = ({ start }: { start: ComposeBodyMode }) => {
	const [mode, setMode] = useState<ComposeBodyMode>(start);
	return (
		<ComposeModeToggle
			mode={mode}
			onToggle={() => setMode(mode === "plain" ? "rich" : "plain")}
		/>
	);
};

export const RichText: Story = {
	name: "Rich text — plain text on offer",
	render: () => <Harness start="rich" />,
};

export const PlainText: Story = {
	name: "Plain text — the mode is on",
	render: () => <Harness start="plain" />,
};

export const PressedStateFollowsTheMode: Story = {
	render: () => <Harness start="rich" />,
	play: async ({ canvasElement }) => {
		const toggle = within(canvasElement).getByTestId("compose-mode-toggle");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await userEvent.click(toggle);
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(toggle).toHaveTextContent("Plain text");
	},
};
