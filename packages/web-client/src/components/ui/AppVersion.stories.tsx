import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppVersion } from "./AppVersion";

const meta: Meta<typeof AppVersion> = {
	title: "Playground/Shipped/Settings/Advanced/AppVersion",
	component: AppVersion,
	parameters: { layout: "padded" },
	args: {
		sha: "a1b2c3d",
		commitUrl: "https://github.com/remit-mail/reader/commit/a1b2c3d4e5f6",
		buildTime: "2024-06-12T10:30:00.000Z",
	},
};
export default meta;

type Story = StoryObj<typeof AppVersion>;

export const Default: Story = {};

export const DevBuild: Story = {
	args: { sha: "dev", commitUrl: undefined },
};

export const InAboutSection: Story = {
	render: (args) => (
		<div className="mt-4 max-w-sm border-t border-line pt-4">
			<p className="mb-1 text-sm font-medium text-fg">About</p>
			<AppVersion {...args} />
		</div>
	),
};
