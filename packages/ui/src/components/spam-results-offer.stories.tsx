import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { SpamResultsOffer } from "./spam-results-offer.js";

/** Frames the offer at the width of the list pane it sits at the top of. */
const listPaneFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden rounded-lg border border-line bg-canvas"
		style={{ width: 360 }}
	>
		<Story />
	</div>
);

const meta: Meta<typeof SpamResultsOffer> = {
	title: "Components/SpamResultsOffer",
	component: SpamResultsOffer,
	parameters: { layout: "centered" },
	decorators: [listPaneFrame],
};
export default meta;

type Story = StoryObj<typeof SpamResultsOffer>;

/**
 * Spam matches a global search held out of its results. Deliberately quiet —
 * an offer, not a warning — and the action scopes the search to Spam rather
 * than opening a view of its own.
 */
export const Default: Story = {
	args: { count: 3, onScopeToSpam: () => {} },
};

/** One match reads in the singular. */
export const SingleResult: Story = {
	args: { count: 1, onScopeToSpam: () => {} },
};

/** Large counts stay on one line; the figure is tabular so it does not jitter. */
export const ManyResults: Story = {
	args: { count: 128, onScopeToSpam: () => {} },
};
