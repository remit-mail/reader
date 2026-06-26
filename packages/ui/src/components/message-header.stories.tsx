import type { Meta, StoryObj } from "@storybook/react";
import { Menu } from "lucide-react";
import type { EnvelopeAddress } from "./address-display.js";
import { MessageHeader } from "./message-header.js";

const meta: Meta<typeof MessageHeader> = {
	title: "Mail/MessageHeader",
	component: MessageHeader,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof MessageHeader>;

const named = (name: string, email: string): EnvelopeAddress => ({
	displayName: name,
	normalizedEmail: email,
});

const trustedFrom: EnvelopeAddress = {
	...named("Ada Lovelace", "ada@example.com"),
	flags: { trusted: { value: true } },
};

const date = "Mon, 23 Jun 2026, 14:00";

export const TrustedSender: Story = {
	args: {
		subject: "Quarterly numbers are in",
		from: [trustedFrom],
		to: [named("The team", "team@example.com")],
		date,
		senderTrust: "wellknown",
	},
};

export const NewSenderNewsletter: Story = {
	name: "New sender + newsletter",
	args: {
		subject: "Welcome to the weekly digest",
		from: [named("Digest", "hello@digest.example.com")],
		to: [{ normalizedEmail: "you@example.com" }],
		date,
		category: "newsletter",
		senderTrust: "unknown",
	},
};

export const VipWithManyRecipients: Story = {
	name: "VIP + many recipients",
	args: {
		subject: "Board meeting follow-up",
		from: [{ ...named("Grace Hopper", "grace@example.com") }],
		to: [
			named("Alan Turing", "alan@example.com"),
			named("Katherine Johnson", "katherine@example.com"),
			named("Dorothy Vaughan", "dorothy@example.com"),
			named("Mary Jackson", "mary@example.com"),
		],
		cc: [named("Margaret Hamilton", "margaret@example.com")],
		date,
		senderTrust: "vip",
	},
};

export const NoSubjectWithActions: Story = {
	name: "No subject + actions slot",
	args: {
		from: [named("Someone", "someone@example.com")],
		to: [{ normalizedEmail: "you@example.com" }],
		date,
		senderTrust: "wellknown",
		actions: (
			<button type="button" aria-label="Menu" className="text-fg-muted">
				<Menu className="size-5" />
			</button>
		),
	},
};
