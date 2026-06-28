import type { Meta, StoryObj } from "@storybook/react";
import type { IntelligenceData } from "./intelligence-panel.js";
import { IntelligencePanel } from "./intelligence-panel.js";

const base: IntelligenceData = {
	sender: {
		name: "Alex Rivera",
		email: "alex@example.com",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.com",
		dkimDomain: "example.com",
		summary: "We verified this message was really sent by example.com.",
	},
	category: { value: "Personal" },
	similar: [],
};

const meta: Meta<typeof IntelligencePanel> = {
	title: "Screens/Kit/IntelligencePanel",
	component: IntelligencePanel,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof IntelligencePanel>;

export const Aligned: Story = {
	args: { data: base },
};

export const CautionNoSignal: Story = {
	args: {
		data: {
			...base,
			sender: {
				name: "Notifications",
				email: "no-reply@unknown-source.example",
				trust: "unknown",
				firstSeenLabel: "today",
			},
			authenticity: {
				verdict: "caution",
				fromDomain: "unknown-source.example",
				summary:
					"We can't verify the sender of this email, which could mean it's from an insecure source.",
			},
		},
	},
};

export const Impersonation: Story = {
	args: {
		data: {
			...base,
			sender: {
				name: "Your Bank",
				email: "security@your-bank.example",
				trust: "unknown",
				firstSeenLabel: "today",
			},
			category: { value: "Phishing" },
			authenticity: {
				verdict: "mismatch",
				fromDomain: "your-bank.example",
				dkimDomain: "mailer.suspicious.example",
				claimedBrand: "Your Bank",
				summary:
					'The display name claims "Your Bank", but this message was actually sent from mailer.suspicious.example — not your-bank.example. Real senders use their own address.',
				similarCount: 4,
			},
		},
	},
};

export const UnreadableSender: Story = {
	args: {
		data: {
			...base,
			sender: {
				name: "Mailbox Admin",
				email: "missing_mailbox@missing_domain",
				trust: "unknown",
				firstSeenLabel: "today",
				addressUnverified: true,
			},
			category: { value: "Phishing" },
			authenticity: {
				verdict: "mismatch",
				fromDomain: "",
				addressUnreadable: true,
				summary:
					"We couldn't read this sender's address, so we can't confirm who really sent this message.",
			},
		},
	},
};

export const WithSimilarMessages: Story = {
	args: {
		data: {
			...base,
			similar: [
				{
					id: "msg-1",
					fromName: "Alex Rivera",
					subject: "Re: Q3 planning notes",
					timeLabel: "Jan 17",
					matched: "subject",
				},
				{
					id: "msg-2",
					fromName: "Billing",
					subject: "Your invoice is ready",
					timeLabel: "Yesterday",
					matched: "body",
				},
				{
					id: "msg-3",
					fromName: "",
					subject: "(No subject)",
					timeLabel: "Dec 4, 2024",
					matched: "sender",
				},
			],
		},
	},
};
