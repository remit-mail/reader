import type { RemitImapLabelResponse } from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LabelsList } from "./LabelsList";

const meta: Meta<typeof LabelsList> = {
	title: "Flows/Settings Labels/LabelsList",
	component: LabelsList,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md">
				<Story />
			</div>
		),
	],
	args: {
		onRename: () => undefined,
		onRecolor: () => undefined,
		onDelete: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof LabelsList>;

const makeLabel = (
	overrides: Partial<RemitImapLabelResponse>,
): RemitImapLabelResponse => ({
	labelId: "lbl-1",
	accountConfigId: "acc-1",
	name: "Receipts",
	color: "Blue",
	createdAt: 0,
	updatedAt: 0,
	filterCount: 0,
	...overrides,
});

const fewLabels: RemitImapLabelResponse[] = [
	makeLabel({
		labelId: "lbl-1",
		name: "Receipts",
		color: "Blue",
		filterCount: 0,
	}),
	makeLabel({
		labelId: "lbl-2",
		name: "Travel",
		color: "Green",
		filterCount: 1,
	}),
	makeLabel({ labelId: "lbl-3", name: "Urgent", color: "Red", filterCount: 3 }),
];

const manyLabels: RemitImapLabelResponse[] = [
	...fewLabels,
	makeLabel({
		labelId: "lbl-4",
		name: "Newsletters",
		color: "Yellow",
		filterCount: 2,
	}),
	makeLabel({
		labelId: "lbl-5",
		name: "Work",
		color: "Purple",
		filterCount: 0,
	}),
	makeLabel({
		labelId: "lbl-6",
		name: "Family",
		color: "Teal",
		filterCount: 0,
	}),
	makeLabel({
		labelId: "lbl-7",
		name: "Finance",
		color: "Orange",
		filterCount: 4,
	}),
	makeLabel({
		labelId: "lbl-8",
		name: "Recruiting",
		color: "Gray",
		filterCount: 1,
	}),
	makeLabel({
		labelId: "lbl-9",
		name: "Quarterly compliance filings that need a second look",
		color: "Default",
		filterCount: 1,
	}),
];

/** No labels yet — the empty-state copy points at the create form below. */
export const Empty: Story = {
	args: { labels: [] },
};

/** A few labels, each showing its filter-usage line. */
export const Few: Story = {
	args: { labels: fewLabels },
};

/** The same few labels, on the dark theme. */
export const FewDark: Story = {
	name: "Few (dark)",
	parameters: { theme: "dark" },
	args: { labels: fewLabels },
};

/** Many labels, including one with a long name that truncates in its chip. */
export const Many: Story = {
	args: { labels: manyLabels },
};

/**
 * Renaming inline: clicking a label's chip swaps it for a focused text input.
 * Driven here rather than passed as a prop — `editingId` is internal state.
 */
export const Renaming: Story = {
	args: { labels: fewLabels },
	play: async ({ canvasElement }) => {
		const renameButton = canvasElement.querySelector<HTMLButtonElement>(
			'button[aria-label="Rename label Receipts"]',
		);
		renameButton?.click();
	},
};

/** A delete in flight — the row's delete button disables. */
export const Deleting: Story = {
	args: { labels: fewLabels, deletingLabelId: "lbl-2" },
};
