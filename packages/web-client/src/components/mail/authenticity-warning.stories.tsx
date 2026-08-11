import { type IntelligenceData, IntelligencePanel } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Drawer } from "@/components/layout/Drawer";
import { AuthenticityBanner } from "@/components/mail/AuthenticityBanner";

/**
 * The authenticity warning over the reading pane, and where its "Why?" goes.
 *
 * Between 1024 and 1280px the shell has room for the reading pane but not the
 * intelligence rail, so the link opens the same right-anchored drawer the phone
 * uses — `MailboxPane.Reading` mounts it whenever the rail does not fit. The
 * warning itself reads as one sentence: the link sits in the text flow at the
 * body's own size rather than floating off to the right as chrome.
 */
const meta: Meta<typeof AuthenticityBanner> = {
	title: "Flows/Reading/Authenticity Warning",
	component: AuthenticityBanner,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AuthenticityBanner>;

const TWO_PANE_WIDTH = 1100;

const authenticity = {
	fromDomain: "mondialrelay.fr",
	dkimDomain: "gmail.example",
	dkimMismatch: true,
};

const intelligence: IntelligenceData = {
	sender: {
		name: "Mondial Relay",
		email: "delivery.notice.4421@gmail.example",
		trust: "unknown",
		firstSeenLabel: "today",
		inboundCount: 1,
		replyCount: 0,
	},
	authenticity: {
		verdict: "mismatch",
		fromDomain: "mondialrelay.fr",
		dkimDomain: "gmail.example",
		claimedBrand: "Mondial Relay",
		summary:
			"The display name claims “Mondial Relay”, but the message was sent and signed by a personal gmail.example mailbox — not mondialrelay.fr. Real carriers send from their own domain.",
		similarCount: 15,
	},
	category: { value: "automated" },
	flags: {},
	similar: [
		{
			id: "sim_dhl",
			mailboxId: "mbx_personal_junk",
			threadId: "thr_sim_dhl",
			fromName: "DHL Express",
			subject: "Action required: customs fee outstanding",
			timeLabel: "Thu",
			matched: "body",
		},
		{
			id: "sim_postnl",
			mailboxId: "mbx_personal_junk",
			threadId: "thr_sim_postnl",
			fromName: "PostNL",
			subject: "Uw pakket kon niet worden bezorgd",
			timeLabel: "28 May",
			matched: "body",
		},
	],
};

/**
 * The reading pane as `MailboxPane.Reading` composes it at this width: the
 * banner above the thread body, and the drawer it opens over the panes.
 */
const TwoPaneReading = () => {
	const [drawerOpen, setDrawerOpen] = useState(false);
	return (
		<div
			className="flex overflow-hidden rounded-lg border border-line bg-canvas"
			// The transform makes the frame a containing block, so the drawer's
			// `position: fixed` resolves against these 1100px instead of the
			// Storybook canvas. `relative` does not do this for fixed children.
			style={{ width: TWO_PANE_WIDTH, height: 700, transform: "translateZ(0)" }}
		>
			<div className="w-[38%] shrink-0 border-r border-line bg-surface-sunken" />
			<section className="flex min-w-0 flex-1 flex-col">
				<header className="border-b border-line px-5 pt-5 pb-3">
					<h1 className="max-w-2xl text-lg font-semibold leading-snug text-fg">
						Your parcel could not be delivered
					</h1>
					<p className="mt-1 text-2xs text-fg-subtle">1 message</p>
				</header>
				<AuthenticityBanner
					authenticity={authenticity}
					onOpenIntelligence={() => setDrawerOpen(true)}
				/>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-fg">
					<p>
						We attempted to deliver your parcel today and nobody was home. Pay
						the outstanding €2.40 redelivery fee within 24 hours to schedule a
						new attempt.
					</p>
				</div>
			</section>
			<Drawer
				isOpen={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				ariaLabel="Message details"
				side="right"
			>
				<IntelligencePanel data={intelligence} hideCloseButton />
			</Drawer>
		</div>
	);
};

/** Two panes, no rail: press "Why?" and the drawer carries the panel. */
export const TwoPaneDesktop: Story = {
	render: () => <TwoPaneReading />,
};

/** The same surface on the dark theme. */
export const TwoPaneDesktopDark: Story = {
	name: "Two Pane Desktop (dark)",
	parameters: { theme: "dark" },
	render: () => <TwoPaneReading />,
};
