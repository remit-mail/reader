import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Avatar } from "./avatar.js";
import type { SearchChip } from "./search-chip-input.js";
import { type ShellSearchScope, ShellTopBar } from "./shell-top-bar.js";

const meta: Meta<typeof ShellTopBar> = {
	title: "Mail/ShellTopBar",
	component: ShellTopBar,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ShellTopBar>;

const SCOPE: SearchChip = { id: "in:spam", label: "in:spam", tone: "scope" };

const Account = () => (
	<button type="button" aria-label="Account">
		<Avatar name="Matthijs van Henten" email="mvh@example.com" size="sm" />
	</button>
);

const Bar = ({
	initialChips,
	scope = "global",
}: {
	initialChips?: SearchChip[];
	scope?: ShellSearchScope;
}) => {
	const [chips, setChips] = useState<SearchChip[] | undefined>(initialChips);
	const [value, setValue] = useState("");
	return (
		<ShellTopBar
			search={{
				value,
				scope: chips?.length ? scope : "global",
				chips,
				onChange: setValue,
				onClear: () => {
					setValue("");
					setChips(undefined);
				},
				onClearQuery: () => setValue(""),
				onRemoveChip: () => setChips(undefined),
			}}
			onCompose={() => undefined}
			onReportBug={() => undefined}
			onOpenSettings={() => undefined}
			composeShortcut="c"
			account={<Account />}
		/>
	);
};

/**
 * The daily brief's state: search unscoped, nothing narrowing it, and the only
 * placeholder allowed to claim it searches all mail — which it genuinely does,
 * across every folder of every account.
 */
export const Unscoped: Story = {
	render: () => <Bar />,
};

/**
 * A narrowing scope in the bar, tinted to mark it as the view the user is in
 * rather than a filter they typed. Removing it widens the search again — a
 * navigation back to the brief, not an edit of the text, because the chip
 * mirrors the route. The placeholder narrows with the chip.
 */
export const Scoped: Story = {
	render: () => <Bar initialChips={[SCOPE]} scope="scoped" />,
};

/**
 * A mailbox route whose name has not resolved yet. The list underneath is
 * already narrowed, so the bar must not claim to search everything — and a chip
 * reading a raw uuid is worse than no chip, so it shows none and falls back to
 * neutral wording until the name arrives.
 */
export const ScopePending: Story = {
	render: () => (
		<ShellTopBar
			search={{
				value: "",
				scope: "pending",
				onChange: () => undefined,
				onClear: () => undefined,
				onClearQuery: () => undefined,
			}}
			onCompose={() => undefined}
			onReportBug={() => undefined}
			onOpenSettings={() => undefined}
			composeShortcut="c"
			account={<Account />}
		/>
	),
};

/**
 * The virtual collections scope the bar too, and their chips read as whatever
 * describes the collection. Flagged is a marker on the mail rather than a
 * place, so it chips `is:starred`.
 */
export const ScopedToFlagged: Story = {
	render: () => (
		<Bar
			initialChips={[{ id: "is:starred", label: "is:starred", tone: "scope" }]}
			scope="scoped"
		/>
	),
};

/** The arrangement: one bar across the top of the shell, over every pane. */
export const OverTheLayout: Story = {
	render: () => (
		<div className="flex h-96 flex-col bg-canvas">
			<Bar initialChips={[SCOPE]} scope="scoped" />
			<div className="flex min-h-0 flex-1">
				<div className="w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
					Nav — under the bar, like every other pane
				</div>
				<div className="w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
					Message list
				</div>
				<div className="min-w-0 flex-1 p-3 text-xs text-fg-muted">
					Message pane — its own toolbar lives here, under the bar
				</div>
			</div>
		</div>
	),
};
