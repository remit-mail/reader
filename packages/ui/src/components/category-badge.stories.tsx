import type { Meta, StoryObj } from "@storybook/react";
import { CategoryBadge, type MessageCategory } from "./category-badge.js";

const meta: Meta<typeof CategoryBadge> = {
	title: "Mail/CategoryBadge",
	component: CategoryBadge,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof CategoryBadge>;

const categories: MessageCategory[] = [
	"newsletter",
	"marketing",
	"automated",
	"transactional",
	"social",
];

export const AllCategories: Story = {
	render: () => (
		<div className="flex flex-wrap items-center gap-2">
			{categories.map((category) => (
				<CategoryBadge key={category} category={category} size="md" />
			))}
		</div>
	),
};

export const PersonalRendersNothing: Story = {
	args: { category: "personal", size: "md" },
};

export const ListRowSize: Story = {
	args: { category: "newsletter", size: "sm" },
};
