import type { Meta, StoryObj } from "@storybook/react";
import { AppPasswordHint } from "./app-password-hint.js";

const meta: Meta<typeof AppPasswordHint> = {
	title: "Onboarding/AppPasswordHint",
	component: AppPasswordHint,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof AppPasswordHint>;

export const KnownProvider: Story = {
	args: { url: "https://support.apple.com/en-us/102654" },
};

export const UnknownProvider: Story = {
	args: {},
};
