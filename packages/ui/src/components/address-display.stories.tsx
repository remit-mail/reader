import type { Meta, StoryObj } from "@storybook/react";
import { AddressList, type EnvelopeAddress } from "./address-display.js";

const meta: Meta<typeof AddressList> = {
	title: "Mail/AddressList",
	component: AddressList,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof AddressList>;

const named = (name: string, email: string): EnvelopeAddress => ({
	displayName: name,
	normalizedEmail: email,
});

const trusted: EnvelopeAddress = {
	...named("Ada Lovelace", "ada@example.com"),
	flags: { trusted: { value: true } },
};

export const SingleFromTrusted: Story = {
	name: "From — trusted",
	args: {
		label: "From",
		addresses: [trusted],
		showTrustedBadge: true,
	},
};

export const FewRecipients: Story = {
	args: {
		label: "To",
		addresses: [
			named("Grace Hopper", "grace@example.com"),
			named("Alan Turing", "alan@example.com"),
		],
	},
};

export const ManyRecipientsCollapsed: Story = {
	name: "Many recipients (expandable)",
	args: {
		label: "To",
		addresses: [
			named("Grace Hopper", "grace@example.com"),
			named("Alan Turing", "alan@example.com"),
			named("Katherine Johnson", "katherine@example.com"),
			named("Dorothy Vaughan", "dorothy@example.com"),
			named("Mary Jackson", "mary@example.com"),
			{ normalizedEmail: "no-name@example.com" },
		],
	},
};
