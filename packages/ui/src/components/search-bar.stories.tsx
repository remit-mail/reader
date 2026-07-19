import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SearchBar } from "./search-bar.js";

const meta: Meta<typeof SearchBar> = {
	title: "Mail/SearchBar",
	component: SearchBar,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof SearchBar>;

const Interactive = ({ initial = "" }: { initial?: string }) => {
	const [value, setValue] = useState(initial);
	return (
		<div className="w-80">
			<SearchBar
				value={value}
				onChange={setValue}
				onClear={() => setValue("")}
				onClearQuery={() => setValue("")}
				globalFocusKey={false}
			/>
		</div>
	);
};

export const Empty: Story = {
	render: () => <Interactive />,
};

export const Typing: Story = {
	render: () => <Interactive initial="invoi" />,
};

export const WithQuery: Story = {
	render: () => <Interactive initial="from:acme receipt" />,
};

export const Focused: Story = {
	render: () => <Interactive />,
	play: async ({ canvasElement }) => {
		canvasElement
			.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')
			?.focus();
	},
};
