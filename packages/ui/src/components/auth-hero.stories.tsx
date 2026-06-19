import type { Meta, StoryObj } from "@storybook/react";
import { AuthHero } from "./auth-hero.js";

const meta: Meta<typeof AuthHero> = {
	title: "Auth/AuthHero",
	component: AuthHero,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AuthHero>;

export const Dark: Story = {
	parameters: { theme: "dark" },
};

export const Light: Story = {
	parameters: { theme: "light" },
};
