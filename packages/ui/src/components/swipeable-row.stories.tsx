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

function GestureRow({
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
			/>
		</PhoneFrame>
	);
}

const rowElement = (canvasElement: HTMLElement) =>
	canvasElement.querySelector<HTMLButtonElement>("button[data-message-row]");

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
				<GestureRow
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
 * The same gesture with a real finger's drift. A hand holding still on glass
 * wanders several pixels over the 500ms hold — further than the distance at
 * which the drag starts tracking the row, which is why a hold used to nudge
 * the row and then do nothing. The swipe only takes the gesture once it has
 * travelled far enough to commit a peek, so the drifting hold below still ends
 * in selection mode. The play step drives the press, the drift and the hold.
 */
export const LongPressWithDrift: Story = {
	name: "Long press with finger drift (interactive)",
	render: () => {
		const [selected, setSelected] = useState(false);
		return (
			<div className="space-y-2">
				<GestureRow
					selectionMode={selected}
					checked={selected}
					onLongPress={() => setSelected(true)}
				/>
				<p data-testid="drift-outcome" className="text-xs text-fg-muted">
					{selected
						? "Drifting hold entered selection mode."
						: "Waiting for the drifting hold…"}
				</p>
			</div>
		);
	},
	play: async ({ canvasElement }) => {
		const row = rowElement(canvasElement);
		if (!row) return;
		const touch = (type: string, clientX: number, clientY: number) =>
			row.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					pointerType: "touch",
					pointerId: 1,
					clientX,
					clientY,
				}),
			);
		touch("pointerdown", 100, 200);
		for (const [x, y] of [
			[103, 201],
			[106, 203],
			[109, 205],
			[112, 206],
		]) {
			touch("pointermove", x, y);
		}
		await new Promise((resolve) => setTimeout(resolve, 700));
		touch("pointerup", 112, 206);
	},
};

/**
 * A touch long press over a row normally raises the browser's own context menu,
 * which collides with the long-press-to-select gesture above. `useLongPress`
 * suppresses that menu when the press came from touch or pen, while leaving a
 * mouse right-click's menu alone. The play step drives a synthetic touch press
 * then a contextmenu and writes the outcome below.
 */
export const TouchContextMenuSuppressed: Story = {
	name: "Touch context menu suppressed",
	render: () => (
		<div className="space-y-2">
			<GestureRow />
			<p data-testid="context-menu-outcome" className="text-xs text-fg-muted">
				Waiting for a touch press…
			</p>
		</div>
	),
	play: async ({ canvasElement }) => {
		const row = rowElement(canvasElement);
		const outcome = canvasElement.querySelector<HTMLParagraphElement>(
			'[data-testid="context-menu-outcome"]',
		);
		if (!row || !outcome) return;
		row.dispatchEvent(
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
		row.dispatchEvent(menu);
		outcome.textContent = menu.defaultPrevented
			? "Native context menu suppressed on touch."
			: "Native context menu allowed.";
	},
};
