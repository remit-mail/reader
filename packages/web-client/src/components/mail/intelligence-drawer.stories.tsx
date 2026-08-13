import { type IntelligenceData, IntelligencePanel } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, Info } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Drawer } from "@/components/layout/Drawer";
import { resolveRailOpen } from "@/lib/intelligence-pref";
import { parseOpenPanels, retainOpenPanelsAtTier } from "@/routing";

/**
 * The intelligence drawer below the desktop tier (#777).
 *
 * There is no fourth pane here: the rail is a full-screen drawer over the open
 * message, so it belongs to the thread it was opened for. The address is the
 * only place its open state lives, and a navigation drops it — otherwise a DKIM
 * mismatch on one message leaves the drawer covering every message opened
 * after it.
 *
 * Both rules are the app's own: the fragment goes through
 * `retainOpenPanelsAtTier`, and what is up is `resolveRailOpen`.
 */
const meta: Meta = {
	title: "Flows/Reading/Intelligence Drawer",
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 720;

const retainOnPhone = retainOpenPanelsAtTier(false);

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
			"The display name claims “Mondial Relay”, but the message was sent and signed by a personal gmail.example mailbox — not mondialrelay.fr.",
		similarCount: 15,
	},
	category: { value: "automated" },
	similar: [],
};

interface Message {
	id: string;
	from: string;
	subject: string;
	body: string;
}

const messages: readonly Message[] = [
	{
		id: "msg-parcel",
		from: "Mondial Relay",
		subject: "Your parcel could not be delivered",
		body: "We attempted to deliver your parcel today and nobody was home. Pay the outstanding €2.40 redelivery fee within 24 hours.",
	},
	{
		id: "msg-standup",
		from: "Alex Rivera",
		subject: "Standup moved to 10:15",
		body: "Pushing today's standup back fifteen minutes — the room is taken until then.",
	},
];

/**
 * The phone reader, driven by the address alone: `hash` is the whole state,
 * and every navigation writes it through the same helper the panes use.
 */
const PhoneReader = ({ initialHash = "" }: { initialHash?: string }) => {
	const [hash, setHash] = useState(initialHash);
	const [openId, setOpenId] = useState<string | undefined>(messages[0]?.id);
	const open = messages.find((message) => message.id === openId);
	const drawerOpen = resolveRailOpen({
		panels: parseOpenPanels(hash),
		prefersOpen: true,
		isDesktop: false,
		hasThread: open !== undefined,
	});
	const navigate = (nextId: string | undefined) => {
		setHash(retainOnPhone(hash));
		setOpenId(nextId);
	};

	return (
		<div className="flex flex-col gap-2">
			<div
				className="flex flex-col overflow-hidden rounded-lg border border-line bg-canvas"
				// The transform makes the frame a containing block, so the drawer's
				// `position: fixed` resolves against the phone instead of the canvas.
				style={{
					width: PHONE_WIDTH,
					height: PHONE_HEIGHT,
					transform: "translateZ(0)",
				}}
			>
				{open ? (
					<>
						<header className="flex items-center gap-1 border-b border-line px-2 py-2">
							<button
								type="button"
								aria-label="Back"
								onClick={() => navigate(undefined)}
								className="inline-flex size-11 items-center justify-center rounded-md text-fg hover:bg-surface-raised"
							>
								<ChevronLeft className="size-5" />
							</button>
							<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
								{open.subject}
							</h1>
							<button
								type="button"
								aria-label="Message details"
								onClick={() => setHash("intelligence")}
								className="inline-flex size-11 items-center justify-center rounded-md text-fg hover:bg-surface-raised"
							>
								<Info className="size-5" />
							</button>
						</header>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-fg">
							<p className="mb-2 text-2xs text-fg-subtle">{open.from}</p>
							<p>{open.body}</p>
						</div>
					</>
				) : (
					<ul className="flex flex-col">
						{messages.map((message) => (
							<li key={message.id}>
								<button
									type="button"
									onClick={() => navigate(message.id)}
									className="flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-3 text-left hover:bg-surface-raised"
								>
									<span className="text-sm font-semibold text-fg">
										{message.from}
									</span>
									<span className="text-sm text-fg-muted">
										{message.subject}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				<Drawer
					isOpen={drawerOpen}
					onClose={() => setHash("")}
					ariaLabel="Message details"
					side="right"
				>
					<IntelligencePanel data={intelligence} hideCloseButton />
				</Drawer>
			</div>
			<p className="font-mono text-2xs text-fg-subtle">
				{`/mail/inbox${open ? `/${open.id}` : ""}${hash ? `#${hash}` : ""}`}
			</p>
		</div>
	);
};

/** A message with no drawer over it: the address names no panel. */
export const Closed: Story = {
	render: () => <PhoneReader />,
};

/**
 * The drawer over the message it was opened for — here by a DKIM mismatch,
 * which opens it without being asked.
 */
export const OpenOverThread: Story = {
	render: () => <PhoneReader initialHash="intelligence" />,
};

/**
 * The same drawer, then Back and another message. The fragment is dropped on
 * the way out, so the second message is not covered by a panel opened for the
 * first. Press Back with the drawer up to walk it.
 */
export const DroppedByNavigation: Story = {
	render: () => <PhoneReader initialHash="intelligence" />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByLabelText("Back"));
		await userEvent.click(canvas.getByText("Standup moved to 10:15"));
		await expect(canvas.queryByRole("dialog")).toBeNull();
		await expect(canvas.getByText("/mail/inbox/msg-standup")).toBeVisible();
	},
};

/** The drawer over the dark theme. */
export const OpenOverThreadDark: Story = {
	name: "Open Over Thread (dark)",
	parameters: { theme: "dark" },
	render: () => <PhoneReader initialHash="intelligence" />,
};
