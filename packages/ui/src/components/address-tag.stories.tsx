import type { Meta, StoryObj } from "@storybook/react";
import { AddressTag } from "./address-tag.js";

const meta: Meta<typeof AddressTag> = {
	title: "Compose/AddressTag",
	component: AddressTag,
	parameters: { layout: "centered" },
	args: { onRemove: () => {} },
};
export default meta;

type Story = StoryObj<typeof AddressTag>;

export const EmailOnly: Story = {
	args: { email: "alex@example.com" },
};

export const WithDisplayName: Story = {
	args: { email: "alex@example.com", displayName: "Alex Rivera" },
};

export const LongAddress: Story = {
	args: { email: "very.long.recipient.address@really-long-domain.example.com" },
};

export const Removable: Story = {
	render: () => (
		<div className="flex flex-wrap items-center gap-1">
			<AddressTag
				email="alex@example.com"
				displayName="Alex Rivera"
				onRemove={() => {}}
			/>
			<AddressTag email="sam@example.com" onRemove={() => {}} />
			<AddressTag
				email="very.long.recipient.address@really-long-domain.example.com"
				onRemove={() => {}}
			/>
		</div>
	),
};
