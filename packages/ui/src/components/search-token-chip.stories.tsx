import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SearchTokenChips } from "./search-token-chip.js";

const meta: Meta<typeof SearchTokenChips> = {
	title: "Mail/SearchTokenChips",
	component: SearchTokenChips,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof SearchTokenChips>;

const initialLabels = ["From: dhl.com", "Has attachment", "Unread"];

function Interactive() {
	const [labels, setLabels] = useState(initialLabels);
	return (
		<div className="w-96 rounded-md border border-line">
			<SearchTokenChips
				tokens={labels.map((label) => ({
					label,
					onRemove: () => setLabels((prev) => prev.filter((l) => l !== label)),
				}))}
			/>
		</div>
	);
}

/** Removable filter-token chips under the search field; click × to drop one. */
export const Tokens: Story = {
	render: () => <Interactive />,
};

/** No recognized tokens in the query — the row collapses to nothing. */
export const Empty: Story = {
	render: () => (
		<div className="w-96 rounded-md border border-line">
			<SearchTokenChips tokens={[]} />
		</div>
	),
};
