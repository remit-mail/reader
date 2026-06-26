import type { Meta, StoryObj } from "@storybook/react";
import { SenderTrustIndicator } from "./sender-trust-indicator.js";

const meta: Meta<typeof SenderTrustIndicator> = {
	title: "Mail/SenderTrustIndicator",
	component: SenderTrustIndicator,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof SenderTrustIndicator>;

const Cell = ({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) => (
	<div className="flex items-center gap-2">
		<span className="w-40 text-sm text-fg-muted">{label}</span>
		{children}
	</div>
);

export const HeaderSize: Story = {
	name: "Header (md)",
	render: () => (
		<div className="space-y-2">
			<Cell label="vip">
				<SenderTrustIndicator senderTrust="vip" size="md" />
			</Cell>
			<Cell label="unknown — new sender">
				<SenderTrustIndicator senderTrust="unknown" size="md" />
			</Cell>
			<Cell label="wellknown — silent">
				<SenderTrustIndicator senderTrust="wellknown" size="md" />
			</Cell>
		</div>
	),
};

export const RowSize: Story = {
	name: "Inbox row (sm)",
	render: () => (
		<div className="space-y-2">
			<Cell label="vip">
				<SenderTrustIndicator senderTrust="vip" size="sm" />
			</Cell>
			<Cell label="unknown — silent on rows">
				<SenderTrustIndicator senderTrust="unknown" size="sm" />
			</Cell>
			<Cell label="wellknown — silent">
				<SenderTrustIndicator senderTrust="wellknown" size="sm" />
			</Cell>
		</div>
	),
};
