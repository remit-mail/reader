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
		summary: "This message was signed by example.com.",
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

export const SignedButUnrecognised: Story = {
	args: {
		data: {
			...base,
			sender: {
				name: "InfoMedics",
				email: "jira@serviceupdatebank.atlassian.net",
				trust: "unknown",
				firstSeenLabel: "today",
			},
			category: { value: "Automated" },
			authenticity: {
				verdict: "caution",
				fromDomain: "serviceupdatebank.atlassian.net",
				// Deliberately a different domain than fromDomain: the display-name
				// check compared "InfoMedics" against the sender's own domain, never
				// this one, so the summary must name serviceupdatebank.atlassian.net.
				dkimDomain: "custmx.one.com",
				claimedBrand: "InfoMedics",
				summary:
					'The name it shows, "InfoMedics", has nothing to do with serviceupdatebank.atlassian.net. Its links go to betaal-vordering.example.',
			},
		},
	},
};

export const SignedButLookalikeName: Story = {
	args: {
		data: {
			...base,
			sender: {
				name: "InfoMedics",
				email: "billing@1nfomedics.nl",
				trust: "unknown",
				firstSeenLabel: "today",
			},
			category: { value: "Transactional" },
			authenticity: {
				verdict: "caution",
				fromDomain: "1nfomedics.nl",
				dkimDomain: "1nfomedics.nl",
				claimedBrand: "InfoMedics",
				summary:
					'The name it shows, "InfoMedics", only looks like 1nfomedics.nl.',
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
		similarLinkComponent: ({
			mailboxId,
			messageId,
			className,
			ariaLabel,
			children,
		}) => (
			<a
				href={`/mail/${mailboxId}?selectedMessageId=${messageId}`}
				className={className}
				aria-label={ariaLabel}
			>
				{children}
			</a>
		),
		data: {
			...base,
			similar: [
				{
					id: "msg-1",
					mailboxId: "mbx-1",
					fromName: "Alex Rivera",
					subject: "Re: Q3 planning notes",
					timeLabel: "Jan 17",
					matched: "subject",
				},
				{
					id: "msg-2",
					mailboxId: "mbx-1",
					fromName: "Billing",
					subject: "Your invoice is ready",
					timeLabel: "Yesterday",
					matched: "body",
				},
				{
					id: "msg-3",
					mailboxId: "mbx-2",
					fromName: "",
					subject: "(No subject)",
					timeLabel: "Dec 4, 2024",
					matched: "sender",
				},
			],
		},
	},
};

/**
 * The spam quick actions are a contextual pair, decided by whether the message
 * carries a spam report — never by the mailbox it happens to sit in, since a
 * report on a message already in Junk (the provider's own filter put it there)
 * is a real, no-op-move case (issue #648). A reportable message offers
 * "Report spam".
 */
export const Reportable: Story = {
	args: {
		data: base,
		actions: { onReportSpam: () => {} },
	},
};

/**
 * Already reported: the sender is blocked, so "Not spam" (the undo) is
 * offered instead, and the panel names the sender as reported.
 */
export const Reported: Story = {
	args: {
		data: { ...base, flags: { blocked: true } },
		actions: { onNotSpam: () => {} },
	},
};

/**
 * Neither action is offered — the sender's address record hasn't resolved
 * yet, so there's nothing to service a press with (issue #51's disabled-not-dead
 * rule applies to the pair as a whole, not just VIP/Mute/Unsubscribe).
 */
export const SpamActionUnavailable: Story = {
	args: {
		data: base,
		actions: {},
	},
};

/**
 * The last report-spam attempt failed. A dead button is the worst outcome, so
 * the failure renders inline under the quick actions rather than only in a
 * toast the user may have already looked away from (issue #648).
 */
export const SpamActionFailed: Story = {
	args: {
		data: base,
		actions: { onReportSpam: () => {} },
		spamActionError: "Couldn't report this message as spam. Try again.",
	},
};
