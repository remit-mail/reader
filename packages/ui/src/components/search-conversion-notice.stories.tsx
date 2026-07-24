import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchConversionNoticeView } from "./search-conversion-notice.js";

const meta = {
	title: "Filters/Search conversion notice",
	component: SearchConversionNoticeView,
	parameters: { layout: "centered" },
} satisfies Meta<typeof SearchConversionNoticeView>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A folder-scoped search: the filter cannot be pinned to the folder. */
export const FolderScopedOut: Story = {
	args: { notice: { scopedOutFolder: "Archive" } },
};

/** Attribute facets that are not filter conditions, named rather than dropped silently. */
export const DroppedFacets: Story = {
	args: {
		notice: {
			droppedFacets: ["Has attachment", "Unread", "Before 2026-01-01"],
		},
	},
};

/** A deployment that cannot match by meaning — literal words kept, no similarity claim. */
export const DroppedSemantic: Story = {
	args: { notice: { droppedSemantic: true } },
};

/** Everything a rich search carried that the filter cannot. */
export const Everything: Story = {
	args: {
		notice: {
			scopedOutFolder: "Archive",
			droppedFacets: ["Has attachment", "Before 2026-01-01"],
			droppedSemantic: true,
		},
	},
};
