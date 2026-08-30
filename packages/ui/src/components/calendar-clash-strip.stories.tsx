import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarClashStrip } from "./calendar-clash-strip.js";
import type { CalendarClash } from "./calendar-types.js";

/**
 * The cost of saying yes, drawn before the answer. The clear case is drawn too:
 * an empty space where the check should be reads as "not checked".
 */
const meta: Meta<typeof CalendarClashStrip> = {
	title: "Calendar/Clash strip",
	component: CalendarClashStrip,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof CalendarClashStrip>;

const dentist: CalendarClash = {
	id: "evt_dentist",
	label: "Dentist · 14:30 – 15:15 · Personal (matthijs@)",
};

const standup: CalendarClash = {
	id: "evt_standup",
	label: "Sprint planning · 14:00 – 15:00 · Work (work@)",
};

/** Nothing booked, said out loud. */
export const Clear: Story = {
	args: { clashes: [] },
};

/** One collision, named with the calendar and the account it came from. */
export const OneClash: Story = {
	args: { clashes: [dentist] },
};

/** Several, counted in the sentence so the tally is not left to the eye. */
export const SeveralClashes: Story = {
	args: { clashes: [dentist, standup] },
};

/** The caller knows which span was checked, so it words the clear case. */
export const ClearWithItsOwnWords: Story = {
	args: {
		clashes: [],
		clearText: "Thursday afternoon is empty from 15:15.",
	},
};
