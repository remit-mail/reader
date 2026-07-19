import type { Meta, StoryObj } from "@storybook/react";
import { Bug, Menu, SquarePen } from "lucide-react";
import { useState } from "react";
import { AppTopBar } from "./app-top-bar.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { type SearchChip, SearchChipInput } from "./search-chip-input.js";

const meta: Meta<typeof AppTopBar> = {
	title: "Mail/AppTopBar",
	component: AppTopBar,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppTopBar>;

const Brand = () => (
	<>
		<Button
			variant="ghost"
			icon={<Menu className="size-5" />}
			aria-label="Menu"
			className="px-0 lg:hidden"
		/>
		<span className="px-1 text-sm font-semibold tracking-tight text-fg">
			remit
		</span>
	</>
);

const Actions = () => (
	<>
		<Button
			variant="ghost"
			size="sm"
			icon={<SquarePen className="size-4" />}
			title="Compose"
			aria-label="Compose"
		/>
		<Button
			variant="ghost"
			size="sm"
			icon={<Bug className="size-4" />}
			title="Report a bug"
			aria-label="Report a bug"
		/>
		<Avatar name="Matthijs van Henten" email="mvh@example.com" size="sm" />
	</>
);

const SCOPE: SearchChip = { id: "in:spam", label: "in:spam", tone: "scope" };

const Bar = ({ initialChips = [] }: { initialChips?: SearchChip[] }) => {
	const [chips, setChips] = useState<SearchChip[]>(initialChips);
	const [value, setValue] = useState("");
	return (
		<AppTopBar
			leading={<Brand />}
			actions={<Actions />}
			search={
				<SearchChipInput
					size="lg"
					chips={chips}
					onRemoveChip={(id) => setChips((cs) => cs.filter((c) => c.id !== id))}
					value={value}
					onChange={setValue}
					onClear={() => {
						setValue("");
						setChips([]);
					}}
					onClearQuery={() => setValue("")}
					globalFocusKey={false}
					placeholder="Search all mail"
				/>
			}
		/>
	);
};

/** Over the panes it spans, so the arrangement reads the way it will in the app. */
const WithPanes = ({ children }: { children: React.ReactNode }) => (
	<div className="flex h-96 flex-col bg-canvas">
		{children}
		<div className="flex min-h-0 flex-1">
			<div className="w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
				Nav
			</div>
			<div className="w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
				Message list
			</div>
			<div className="min-w-0 flex-1 p-3 text-xs text-fg-muted">
				Message pane — its own toolbar lives here, under the bar
			</div>
		</div>
	</div>
);

/** The daily brief's state: search unscoped, nothing narrowing it. */
export const Unscoped: Story = {
	render: () => <Bar />,
};

/**
 * A narrowing scope in the bar, tinted to mark it as the view the user is in
 * rather than a filter they typed. Removing it widens the search again.
 */
export const Scoped: Story = {
	render: () => <Bar initialChips={[SCOPE]} />,
};

/** The arrangement: one bar over the nav, the list, and the message pane. */
export const OverTheLayout: Story = {
	render: () => (
		<WithPanes>
			<Bar initialChips={[SCOPE]} />
		</WithPanes>
	),
};

export const SearchOnly: Story = {
	render: () => (
		<AppTopBar
			search={
				<SearchChipInput
					size="lg"
					value=""
					onChange={() => undefined}
					onClear={() => undefined}
					globalFocusKey={false}
					placeholder="Search all mail"
				/>
			}
		/>
	),
};
