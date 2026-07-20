/**
 * AppShellSlotted stories — the slot-based variant of the 4-pane shell.
 *
 * These stories verify the layout contract without wiring real data. Use
 * them to check pane reflow by width (drag the viewport) and to develop
 * the live web-client's compound components against the correct shell API.
 */
import { AppShellSlotted, type AppShellSlottedProps } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta: Meta<typeof AppShellSlotted> = {
	title: "Screens/AppShellSlotted",
	component: AppShellSlotted,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShellSlotted>;

function SlotPlaceholder({
	label,
	className = "bg-surface-raised",
}: {
	label: string;
	className?: string;
}) {
	return (
		<div
			className={`flex h-full w-full items-center justify-center text-sm text-fg-muted ${className}`}
		>
			{label}
		</div>
	);
}

function StatefulSlotted({
	startOpen = true,
	...overrides
}: Partial<AppShellSlottedProps> & { startOpen?: boolean }) {
	const [open, _setOpen] = useState(startOpen);
	return (
		<AppShellSlotted
			nav={<SlotPlaceholder label="Nav" className="bg-canvas" />}
			list={<SlotPlaceholder label="List" />}
			reading={<SlotPlaceholder label="Reading" className="bg-canvas" />}
			intelligence={<SlotPlaceholder label="Intelligence" />}
			intelligenceOpen={open}
			header={
				<div className="flex h-12 items-center gap-2 border-b border-line bg-canvas px-4 text-sm font-medium">
					<span>App header (narrow only)</span>
				</div>
			}
			overlay={
				<div className="fixed bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white text-xs">
					FAB
				</div>
			}
			{...overrides}
		/>
	);
}

/**
 * 4-pane layout: nav / list / reading / intelligence slots all visible
 * at 1280px+. Drag the Storybook viewport to see pane reflow — reading
 * pane drops at <1024px, nav becomes a slide-over below that.
 */
export const Default: Story = {
	render: () => <StatefulSlotted />,
};

/** Intelligence pane closed — the reading pane takes the freed width. */
export const IntelligenceClosed: Story = {
	render: () => <StatefulSlotted startOpen={false} />,
};

/**
 * 2-pane: only list + reading supplied (no intelligence slot).
 * The reading pane still appears at ≥1024px; no intelligence rail at any width.
 */
export const TwoPaneOnly: Story = {
	render: () => (
		<AppShellSlotted
			nav={<SlotPlaceholder label="Nav" className="bg-canvas" />}
			list={<SlotPlaceholder label="List" />}
			reading={<SlotPlaceholder label="Reading" className="bg-canvas" />}
		/>
	),
};

/**
 * The `topBar` slot: a full-width row above every pane, the nav included.
 *
 * This is the arrangement the app actually mounts. Unlike `header`, which sits
 * inside the pane group and only appears while the nav is a slide-over, the top
 * bar spans the whole shell at every width — and that width is what makes the
 * search field in it read as the app's search rather than the list's. The pane
 * headers drop their own search field wherever it is mounted, so the page
 * carries exactly one search input.
 */
export const WithTopBar: Story = {
	render: () => (
		<StatefulSlotted
			topBar={
				<div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
					<span className="text-sm font-semibold tracking-tight">remit</span>
					<div className="mx-auto h-9 w-full max-w-xl rounded-lg border border-line bg-surface px-3 text-sm leading-9 text-fg-subtle">
						Search all mail
					</div>
					<span className="text-xs text-fg-muted">actions</span>
				</div>
			}
		/>
	),
};

/**
 * Skeleton replaces the layout during a cold load (`isLoading=true`).
 * The nav / list / reading / intelligence slots are not rendered.
 */
export const Loading: Story = {
	render: () => (
		<StatefulSlotted
			isLoading
			skeleton={
				<div className="flex h-full w-full items-center justify-center bg-canvas text-sm text-fg-muted">
					Skeleton (cold load)
				</div>
			}
		/>
	),
};
