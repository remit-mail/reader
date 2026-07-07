import type { Meta, StoryObj } from "@storybook/react";
import { AuthFooter } from "./auth-footer.js";

const meta: Meta<typeof AuthFooter> = {
	title: "Auth/AuthFooter",
	component: AuthFooter,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AuthFooter>;

export const Dark: Story = {
	parameters: { theme: "dark" },
};

export const Light: Story = {
	parameters: { theme: "light" },
};

export const CognitoProvider: Story = {
	args: { note: "Secure sign-in powered by AWS Cognito" },
};
