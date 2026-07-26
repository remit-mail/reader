import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { ThreadRowData } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

const sampleThread: ThreadRowData = {
	id: "thread-1",
	accountId: "account-1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Here are the notes from our planning session earlier today.",
	timeLabel: "9:42",
	isRead: false,
};

const baseArgs = {
	thread: sampleThread,
	selectionMode: false,
	checked: false,
	active: false,
	onPeek: () => undefined,
	onToggleCheck: () => undefined,
	onLongPress: () => undefined,
	onOpen: () => undefined,
	onAct: () => undefined,
};

function PhoneFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="max-w-md overflow-hidden rounded-lg border border-line">
			{children}
		</div>
	);
}

const meta: Meta<typeof SwipeableRow> = {
	title: "Primitives/SwipeableRow",
	component: SwipeableRow,
	parameters: { layout: "padded" },
	args: baseArgs,
	render: (args) => (
		<PhoneFrame>
			<SwipeableRow {...args} />
		</PhoneFrame>
	),
};
export default meta;

type Story = StoryObj<typeof SwipeableRow>;

export const Rest: Story = { args: { peek: "none" } };

export const PeekedLeading: Story = { args: { peek: "leading" } };

export const PeekedTrailing: Story = { args: { peek: "trailing" } };

/**
 * In selection mode the leading avatar is REPLACED by a checkbox affordance
 * — unchecked below, checked in the next story. `baseArgs` never flips
 * `selectionMode`/`checked`, so this row-level toggle had zero coverage.
 */
export const SelectionUnchecked: Story = {
	args: { peek: "none", selectionMode: true, checked: false },
};

/** Selection mode, row checked: the circle fills accent and shows a tick. */
export const SelectionChecked: Story = {
	args: { peek: "none", selectionMode: true, checked: true },
};

/**
 * The open affordance is rendered as a real `<a href>` via `linkComponent`,
 * so deep-link, middle-click and open-in-new-tab work. Consumers pass their
 * router's Link; here a plain anchor stands in. Inspect the DOM: the row is an
 * anchor, not a button.
 */
export const AsAnchor: Story = {
	name: "As anchor (linkComponent)",
	args: {
		peek: "none",
		linkComponent: ({ onOpenClick, children, ...rowProps }) => (
			<a
				{...rowProps}
				href="/mail/inbox?selectedMessageId=thread-1"
				onClick={(e) => {
					e.preventDefault();
					onOpenClick(e);
				}}
			>
				{children}
			</a>
		),
	},
};

export const Acting: Story = {
	name: "Acting (interactive)",
	render: () => {
		const [thread, setThread] = useState<ThreadRowData>(sampleThread);
		const [peek, setPeek] = useState<SwipePeek>("trailing");
		const [deleted, setDeleted] = useState(false);
		if (deleted) {
			return (
				<PhoneFrame>
					<div className="flex h-16 items-center justify-center text-sm text-fg-muted">
						Message deleted
					</div>
				</PhoneFrame>
			);
		}
		return (
			<PhoneFrame>
				<SwipeableRow
					{...baseArgs}
					thread={thread}
					peek={peek}
					onPeek={setPeek}
					onAct={(side) => {
						if (side === "trailing") {
							setDeleted(true);
							return;
						}
						setThread((prev) => ({ ...prev, isRead: !prev.isRead }));
						setPeek("none");
					}}
				/>
			</PhoneFrame>
		);
	},
};

function AnchorRow({
	onLongPress,
	selectionMode,
	checked,
}: {
	onLongPress?: () => void;
	selectionMode?: boolean;
	checked?: boolean;
}) {
	return (
		<PhoneFrame>
			<SwipeableRow
				{...baseArgs}
				peek="none"
				selectionMode={selectionMode ?? false}
				checked={checked ?? false}
				onLongPress={onLongPress ?? (() => undefined)}
				linkComponent={({ onOpenClick, children, ...rowProps }) => (
					<a
						{...rowProps}
						href="/mail/inbox?selectedMessageId=thread-1"
						onClick={(e) => {
							e.preventDefault();
							onOpenClick(e);
						}}
					>
						{children}
					</a>
				)}
			/>
		</PhoneFrame>
	);
}

/**
 * The long press is the way into multi-select on touch. Press and hold the row
 * (mouse hold works too — react-aria fires the long press for both) and it
 * flips into the selection state the `SelectionChecked` story shows: the
 * leading avatar becomes a filled, ticked checkbox and a tap toggles the row
 * instead of opening it.
 */
export const LongPressToSelect: Story = {
	name: "Long press to select (interactive)",
	render: () => {
		const [selected, setSelected] = useState(false);
		return (
			<div className="space-y-2">
				<AnchorRow
					selectionMode={selected}
					checked={selected}
					onLongPress={() => setSelected((v) => !v)}
				/>
				<p className="text-xs text-fg-muted">
					{selected
						? "In selection mode — long press again to exit."
						: "Press and hold the row."}
				</p>
			</div>
		);
	},
};

/**
 * A touch long press over a link row normally raises the browser's own link
 * context menu ("Open in new tab / Copy link address"), which collides with the
 * long-press-to-select gesture above. `useLongPress` suppresses that menu when
 * the press came from touch or pen, while leaving a mouse right-click's menu
 * alone. The play step drives a synthetic touch press then a contextmenu and
 * writes the outcome below.
 */
export const TouchContextMenuSuppressed: Story = {
	name: "Touch context menu suppressed",
	render: () => (
		<div className="space-y-2">
			<AnchorRow />
			<p data-testid="context-menu-outcome" className="text-xs text-fg-muted">
				Waiting for a touch press…
			</p>
		</div>
	),
	play: async ({ canvasElement }) => {
		const anchor = canvasElement.querySelector<HTMLAnchorElement>("a[href]");
		const outcome = canvasElement.querySelector<HTMLParagraphElement>(
			'[data-testid="context-menu-outcome"]',
		);
		if (!anchor || !outcome) return;
		anchor.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
			}),
		);
		const menu = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		anchor.dispatchEvent(menu);
		outcome.textContent = menu.defaultPrevented
			? "Native context menu suppressed on touch."
			: "Native context menu allowed.";
	},
};
