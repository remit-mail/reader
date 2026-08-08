import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ComposeSmtpMissingBanner } from "./compose-smtp-missing-banner.js";

/**
 * The selected account has no SMTP host. Send stays pressable and explains
 * itself; this says the same thing before the user reaches for it, and carries
 * the way out rather than leaving them to find Settings.
 */
const meta: Meta<typeof ComposeSmtpMissingBanner> = {
	title: "Mail/ComposeSmtpMissingBanner",
	component: ComposeSmtpMissingBanner,
	parameters: { layout: "padded" },
	args: { onConfigure: fn().mockName("onConfigure") },
};
export default meta;

type Story = StoryObj<typeof ComposeSmtpMissingBanner>;

export const Default: Story = {};

export const TheWayOutIsReachable: Story = {
	args: { onConfigure: fn() },
	play: async ({ args, canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Configure SMTP/ }),
		);
		await expect(args.onConfigure).toHaveBeenCalled();
	},
};
