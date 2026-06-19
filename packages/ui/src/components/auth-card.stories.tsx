import type { Meta, StoryObj } from "@storybook/react";
import { AuthCard } from "./auth-card.js";
import { AuthFooter } from "./auth-footer.js";
import { AuthHero } from "./auth-hero.js";

const meta: Meta<typeof AuthCard> = {
	title: "Auth/AuthCard",
	component: AuthCard,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AuthCard>;

const SampleForm = () => (
	<div className="rounded-md border border-line bg-surface p-7 shadow-lg">
		<div className="space-y-4">
			<div className="space-y-1.5">
				<span className="block text-sm font-medium text-fg">Email</span>
				<div className="h-9 rounded-md border border-line bg-surface" />
			</div>
			<div className="space-y-1.5">
				<span className="block text-sm font-medium text-fg">Password</span>
				<div className="h-9 rounded-md border border-line bg-surface" />
			</div>
			<div className="h-9 rounded-md bg-accent" />
		</div>
		<AuthFooter />
	</div>
);

export const Dark: Story = {
	parameters: { theme: "dark" },
	render: () => (
		<AuthCard>
			<AuthHero />
			<SampleForm />
		</AuthCard>
	),
};

export const Light: Story = {
	parameters: { theme: "light" },
	render: () => (
		<AuthCard>
			<AuthHero />
			<SampleForm />
		</AuthCard>
	),
};
