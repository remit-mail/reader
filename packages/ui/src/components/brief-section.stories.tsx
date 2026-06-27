import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadRowData, ThreadSection } from "./app-shell-types.js";
import { BriefSection } from "./brief-section.js";
import { ComfortableRow } from "./message-row.js";

function makeRow(i: number): ThreadRowData {
	return {
		id: `t${i}`,
		accountId: "a1",
		fromName: `Sender ${i}`,
		fromEmail: `sender${i}@example.com`,
		subject: `Subject line ${i}`,
		snippet: "A short preview of the message body.",
		timeLabel: "9:0" + (i % 10),
		isRead: i % 2 === 0,
		category: "personal",
	};
}

const shortSection: ThreadSection = {
	id: "transactional",
	label: "Transactional",
	threads: Array.from({ length: 3 }, (_, i) => makeRow(i + 1)),
};

const longSection: ThreadSection = {
	id: "newsletter",
	label: "Newsletter",
	threads: Array.from({ length: 18 }, (_, i) => makeRow(i + 1)),
};

const meta: Meta<typeof BriefSection> = {
	title: "Screens/Kit/BriefSection",
	component: BriefSection,
	parameters: { layout: "fullscreen" },
	args: {
		Row: ComfortableRow,
		onSelectThread: () => undefined,
	},
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSection {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof BriefSection>;

/** Fewer than the cap — no expander. */
export const Short: Story = {
	args: { section: shortSection },
};

/** Over the cap — shows the first 10 rows and a "Show N more" control. */
export const CollapsedAtCap: Story = {
	args: { section: longSection },
};

/** The same section after expanding — every row visible, "Show less" to collapse. */
export const Expanded: Story = {
	args: { section: longSection, initialExpanded: true },
};
