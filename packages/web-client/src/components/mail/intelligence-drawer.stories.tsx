import {
	Avatar,
	type IntelligenceData,
	IntelligencePanel,
	RefreshButton,
	ShellTopBar,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, Info } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Drawer } from "@/components/layout/Drawer";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { useIntelligenceDrawer } from "@/hooks/useIntelligenceDrawer";

/**
 * The intelligence drawer below the desktop tier (#777, #778).
 *
 * There is no fourth pane here: the rail is a full-screen drawer over the open
 * message, so it belongs to the thread it was opened for and to nothing else.
 * It is modal, so it opens only when the reader asks — a DKIM mismatch shows
 * the banner and leaves the message alone. A drawer that opened itself would
 * put a scrim over the message, and the reader's next tap would land on the
 * scrim rather than on Back.
 *
 * The rule is the app's own: `useIntelligenceDrawer` is the hook the phone and
 * mid-width panes both run on.
 */
const meta: Meta = {
	title: "Flows/Reading/Intelligence Drawer",
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 720;
const MID_WIDTH = 1100;
const MID_HEIGHT = 640;

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
 * The phone reader. What is open is the thread on screen and, beside it, the
 * drawer the reader asked for — held by `useIntelligenceDrawer` against that
 * thread, so opening another one takes the drawer down with it.
 */
const PhoneReader = () => {
	const [openId, setOpenId] = useState<string | undefined>(messages[0]?.id);
	const open = messages.find((message) => message.id === openId);
	const drawer = useIntelligenceDrawer(open?.id ?? null);

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
								onClick={() => setOpenId(undefined)}
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
								onClick={drawer.toggle}
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
									onClick={() => setOpenId(message.id)}
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
					isOpen={drawer.isOpen}
					onClose={drawer.close}
					ariaLabel="Message details"
					side="right"
				>
					<IntelligencePanel data={intelligence} hideCloseButton />
				</Drawer>
			</div>
			<p className="font-mono text-2xs text-fg-subtle">
				{`/mail/inbox${open ? `/${open.id}` : ""}`}
			</p>
		</div>
	);
};

/** The reader's own press on the details control. */
const openDetails = async (canvasElement: HTMLElement): Promise<void> => {
	await userEvent.click(
		within(canvasElement).getByLabelText("Message details"),
	);
};

/**
 * The warned message as it opens: the banner's own wording, and nothing over
 * it. A mismatch is what the panel explains, never a reason to cover the
 * message with it — a scrim there takes the reader's next tap, Back included.
 */
export const Closed: Story = {
	render: () => <PhoneReader />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("dialog")).toBeNull();
		await expect(canvas.getByLabelText("Back")).toBeVisible();
	},
};

/** The drawer over the message it was opened for. */
export const OpenOverThread: Story = {
	render: () => <PhoneReader />,
	play: async ({ canvasElement }) => {
		await openDetails(canvasElement);
		await expect(within(canvasElement).getByRole("dialog")).toBeVisible();
	},
};

/**
 * Dismissed, and gone for the next message too: the drawer is held against the
 * thread it was opened for, so nothing carries it forward.
 */
export const DismissedAndNotCarried: Story = {
	render: () => <PhoneReader />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await openDetails(canvasElement);
		await expect(canvas.getByRole("dialog")).toBeVisible();

		// The scrim carries the same name as the header's close button and comes
		// first in the drawer, so the visible control is the second of the two.
		await userEvent.click(canvas.getAllByLabelText("Close menu")[1]);
		await expect(canvas.queryByRole("dialog")).toBeNull();

		await userEvent.click(canvas.getByLabelText("Back"));
		await userEvent.click(canvas.getByText("Standup moved to 10:15"));
		await expect(canvas.queryByRole("dialog")).toBeNull();
		await expect(canvas.getByText("/mail/inbox/msg-standup")).toBeVisible();
	},
};

/**
 * The two-pane desktop band between 1024 and 1280px, where the rail has no room
 * and the drawer is the surface. The drawer is right-anchored and 320px wide,
 * so it lands squarely on the reading toolbar's own intelligence toggle — the
 * control that put it there. The shell's top bar is here because the geometry
 * is the point: it is what stands the toolbar clear of the drawer's own header,
 * as it does in the app.
 */
const MidWidthReader = () => {
	const drawer = useIntelligenceDrawer(messages[0]?.id ?? null);
	const [search, setSearch] = useState("");

	return (
		<div
			className="flex flex-col overflow-hidden rounded-lg border border-line bg-canvas"
			// As on the phone frame: the transform makes this a containing block,
			// so the drawer's `position: fixed` resolves against it.
			style={{
				width: MID_WIDTH,
				height: MID_HEIGHT,
				transform: "translateZ(0)",
			}}
		>
			<ShellTopBar
				search={{
					value: search,
					scope: "global",
					onChange: setSearch,
					onClear: () => setSearch(""),
					onClearQuery: () => setSearch(""),
					onRemoveChip: () => undefined,
				}}
				onCompose={() => undefined}
				onReportBug={() => undefined}
				onOpenSettings={() => undefined}
				refreshControl={
					<RefreshButton
						state="idle"
						label="Refresh all accounts"
						onRefresh={() => undefined}
					/>
				}
				account={
					<Avatar
						name="Matthijs van Henten"
						email="mvh@example.com"
						size="sm"
					/>
				}
			/>
			<MessageToolbar
				hasThread
				intelligenceOpen={drawer.isOpen}
				canToggleIntelligence
				onToggleIntelligence={drawer.toggle}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-fg">
				<h1 className="text-lg font-semibold leading-snug">
					{messages[0]?.subject}
				</h1>
				<p className="mt-1 text-2xs text-fg-subtle">{messages[0]?.from}</p>
				<p className="mt-4 max-w-2xl">{messages[0]?.body}</p>
			</div>
			<Drawer
				isOpen={drawer.isOpen}
				onClose={drawer.close}
				ariaLabel="Message details"
				side="right"
			>
				<IntelligencePanel data={intelligence} hideCloseButton />
			</Drawer>
		</div>
	);
};

/**
 * The toggle the drawer covers. It is the only way into this surface for a
 * message with no warning on it, so the drawer lands on it — and stays there:
 * the toggle is the way in and nothing else. Getting back out is the drawer's
 * own job, and its X sits clear of the toggle to do it (#747).
 */
export const CoveredToggle: Story = {
	render: () => <MidWidthReader />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(
			canvas.getByRole("button", { name: "Show intelligence sidebar" }),
		);
		const drawer = canvas.getByRole("dialog", { name: "Message details" });
		await expect(drawer).toBeVisible();

		// The toggle stays in the toolbar the drawer covers. Nothing lifts it over
		// the surface it opened, so a press aimed at it reaches the drawer.
		await expect(drawer).not.toContainElement(
			canvas.getByRole("button", { name: "Hide intelligence sidebar" }),
		);

		// The header's X, not the scrim that shares its name: the second of the
		// two, and the one a reader can see.
		const close = within(drawer).getAllByLabelText("Close menu")[1];
		await expect(close).toBeVisible();
		await userEvent.click(close);

		await expect(
			canvas.queryByRole("dialog", { name: "Message details" }),
		).toBeNull();
		await expect(
			canvas.getByRole("button", { name: "Show intelligence sidebar" }),
		).toHaveAttribute("aria-pressed", "false");
	},
};

/** The drawer over the dark theme. */
export const OpenOverThreadDark: Story = {
	name: "Open Over Thread (dark)",
	parameters: { theme: "dark" },
	render: () => <PhoneReader />,
	play: async ({ canvasElement }) => {
		await openDetails(canvasElement);
	},
};
