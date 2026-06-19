import type { Meta, StoryObj } from "@storybook/react";
import { Banner } from "./banner.js";

const meta: Meta<typeof Banner> = {
	title: "Auth/Banner",
	component: Banner,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Banner>;

export const Info: Story = {
	args: { tone: "info", children: "A new version is available." },
	parameters: { theme: "dark" },
};

export const Success: Story = {
	args: { tone: "success", children: "Your changes were saved." },
	parameters: { theme: "dark" },
};

export const Warning: Story = {
	args: {
		tone: "warning",
		children: (
			<>
				<strong className="font-semibold">Local dev</strong> — Cognito not
				configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID in
				.env.local to enable sign-in.
			</>
		),
	},
	parameters: { theme: "dark" },
};

export const Danger: Story = {
	args: { tone: "danger", children: "Something went wrong." },
	parameters: { theme: "dark" },
};

export const Dismissible: Story = {
	args: {
		tone: "info",
		children: "Dismiss me.",
		onDismiss: () => undefined,
	},
	parameters: { theme: "dark" },
};

export const WarningLight: Story = {
	args: {
		tone: "warning",
		children: (
			<>
				<strong className="font-semibold">Local dev</strong> — Cognito not
				configured.
			</>
		),
	},
	parameters: { theme: "light" },
};

export const SoftOauthSuccess: Story = {
	name: "Soft — OAuth success",
	args: {
		tone: "success",
		variant: "soft",
		children: "Account connected successfully.",
		onDismiss: () => undefined,
	},
};

export const SoftOauthError: Story = {
	name: "Soft — OAuth error",
	args: {
		tone: "danger",
		variant: "soft",
		children:
			"Your organisation's admin needs to approve Remit. Ask your IT admin to grant the required permissions.",
		onDismiss: () => undefined,
	},
};

export const SoftNeutral: Story = {
	name: "Soft — neutral",
	args: {
		tone: "info",
		variant: "soft",
		children: "Preferences are stored locally.",
	},
};
