import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { ListResultHeader } from "./list-result-header.js";

/** Frames the header at the width of the list pane it sits at the top of. */
const listPaneFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden rounded-lg border border-line bg-canvas"
		style={{ width: 360 }}
	>
		<Story />
	</div>
);

const meta: Meta<typeof ListResultHeader> = {
	title: "Components/ListResultHeader",
	component: ListResultHeader,
	parameters: { layout: "centered" },
	decorators: [listPaneFrame],
};
export default meta;

type Story = StoryObj<typeof ListResultHeader>;

/**
 * The count the server answered for the whole match set. It is the total, not
 * the length of the pages loaded, so it does not climb as the reader scrolls.
 */
export const ExactCount: Story = {
	args: { query: "invoice", count: { kind: "exact", value: 1284 } },
};

/** One match reads in the singular. */
export const SingleResult: Story = {
	args: {
		query: "quarterly reconciliation",
		count: { kind: "exact", value: 1 },
	},
};

/** A search that matched nothing states the zero rather than dropping to no number. */
export const NoResults: Story = {
	args: { query: "zzzz", count: { kind: "exact", value: 0 } },
};

/**
 * No number at all: the count was not requested, has not arrived, or the
 * criteria carry an off-row term the server will not count exactly. The header
 * still names what the list is showing — it never substitutes a page length and
 * never falls back to zero.
 */
export const CountUnknown: Story = {
	args: { query: "invoice", count: { kind: "unknown" } },
};

/** A long query keeps the number readable rather than pushing it off the line. */
export const LongQuery: Story = {
	args: {
		query:
			"consolidated quarterly reconciliation of the shared drive migration",
		count: { kind: "exact", value: 42 },
	},
};
