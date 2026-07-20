import type { Meta, StoryObj } from "@storybook/react";
import { PullToRefresh } from "./pull-to-refresh.js";

const rows = Array.from({ length: 20 }, (_, i) => `Message ${i + 1}`);

function MessageList() {
	return (
		<ul className="divide-y divide-line bg-surface">
			{rows.map((row) => (
				<li key={row} className="px-4 py-3 text-sm text-fg">
					{row}
				</li>
			))}
		</ul>
	);
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-[480px] max-w-md overflow-y-auto rounded-lg border border-line">
			{children}
		</div>
	);
}

const meta: Meta<typeof PullToRefresh> = {
	title: "Primitives/PullToRefresh",
	component: PullToRefresh,
	parameters: { layout: "padded" },
	render: (args) => (
		<PhoneFrame>
			<PullToRefresh {...args}>
				<MessageList />
			</PullToRefresh>
		</PhoneFrame>
	),
};
export default meta;

type Story = StoryObj<typeof PullToRefresh>;

export const Idle: Story = {
	name: "Idle — pull to refresh",
	args: {
		onRefresh: () => new Promise((resolve) => setTimeout(resolve, 1200)),
	},
};

export const Refreshing: Story = {
	name: "Refreshing — gesture suspended",
	args: {
		onRefresh: () => Promise.resolve(),
		isRefreshing: true,
	},
};

export const DesktopNoop: Story = {
	name: "Desktop — gesture inert",
	parameters: {
		docs: {
			description: {
				story:
					"At desktop widths (lg, 1024px and up) the gesture is inert and the list renders directly — there is no touch list to pull.",
			},
		},
	},
	globals: { viewport: { value: "desktop" } },
	args: {
		onRefresh: () => Promise.resolve(),
	},
};
