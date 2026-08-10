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
	category: { value: "personal" },
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
			category: { value: "automated" },
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
			category: { value: "transactional" },
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
			category: { value: "automated" },
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
			category: { value: "uncategorized" },
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
 * Already reported: "Not spam" (the undo) is offered instead of "Report
 * spam", and the panel names the message as reported. Driven by
 * `actions.onNotSpam` being present, not by `flags.blocked` — a sender can be
 * blocked manually, with no report on this particular message, and that must
 * not read as "you reported this" (issue #648 review).
 */
export const Reported: Story = {
	args: {
		data: base,
		actions: { onNotSpam: () => {} },
	},
};

/**
 * Neither action is offered. The panel hides the pair rather than disabling
 * it — unlike VIP/Mute/Unsubscribe, which always render and go visibly
 * unavailable with no handler (issue #51). The host's own wiring never
 * actually reaches this: `resolveSpamAction` always returns one of the two,
 * since every message either carries a spam report or doesn't. Kept as a
 * defensive state for a host that doesn't wire the pair at all.
 */
export const SpamActionUnavailable: Story = {
	args: {
		data: base,
		actions: {},
	},
};

/**
 * A "Report spam" press in flight. There's no optimistic update for this
 * action (a report against a message already in Junk is a real no-op-move,
 * issue #648), so without a pending label the button gives no visible
 * response at all until the request lands — the dead-button failure the
 * coding standards call the worst outcome. The button is disabled for the
 * duration: the server dedupes message ids only within a single request, so
 * a second press mid-flight would fire a second, concurrent request rather
 * than join the first (issue #648 review). Still visibly a button, never
 * dead — the "Reporting…" label carries that.
 */
export const ReportSpamPending: Story = {
	args: {
		data: base,
		actions: { onReportSpam: () => {} },
		reportSpamPending: true,
	},
};

/** The undo direction's equivalent — "Undoing…" while `notSpam` is in flight. */
export const NotSpamPending: Story = {
	args: {
		data: base,
		actions: { onNotSpam: () => {} },
		notSpamPending: true,
	},
};
