import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AppTopBar } from "./app-top-bar.js";
import { SearchChipInput } from "./search-chip-input.js";

/**
 * The bar's geometry. What fills it — which actions, in what order, with what
 * wording — is `ShellTopBar`, which is what the app and the shell prototype
 * both mount; these stories show only the row the slots sit in.
 */
const meta: Meta<typeof AppTopBar> = {
	title: "Mail/AppTopBar",
	component: AppTopBar,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppTopBar>;

const Slot = ({ label }: { label: string }) => (
	<div className="rounded border border-dashed border-line px-2 py-1 text-2xs text-fg-subtle">
		{label}
	</div>
);

const Field = () => {
	const [value, setValue] = useState("");
	return (
		<SearchChipInput
			size="lg"
			value={value}
			onChange={setValue}
			onClear={() => setValue("")}
			onClearQuery={() => setValue("")}
			globalFocusKey={false}
			placeholder="Search all mail"
		/>
	);
};

/** Leading · search · actions. The field is the only slot that grows. */
export const Slots: Story = {
	render: () => (
		<AppTopBar
			leading={<Slot label="leading" />}
			search={<Field />}
			actions={<Slot label="actions" />}
		/>
	),
};

/** With nothing but the field, the bar is still the page's one search surface. */
export const SearchOnly: Story = {
	render: () => <AppTopBar search={<Field />} />,
};

/** One row across the top of the shell, over the nav, the list and the message
 *  pane alike. */
export const OverTheLayout: Story = {
	render: () => (
		<div className="flex h-96 flex-col bg-canvas">
			<AppTopBar
				leading={<Slot label="leading" />}
				search={<Field />}
				actions={<Slot label="actions" />}
			/>
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
