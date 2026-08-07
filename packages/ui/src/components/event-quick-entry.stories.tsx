import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { parseEventPhrase } from "../lib/event-phrase.js";
import { EventQuickEntry } from "./event-quick-entry.js";

/**
 * Typing a sentence is the fastest way to make an event, and the machine's
 * reading of that sentence is on screen while you type — each field next to the
 * words it came from, with anything assumed or missing said out loud. The
 * correction happens before the event exists.
 */
const meta: Meta<typeof EventQuickEntry> = {
	title: "Calendar/Quick entry",
	component: EventQuickEntry,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof EventQuickEntry>;

/** Wednesday 10 June 2026 — the same fixed "now" as the mail fixtures. */
const NOW = new Date(2026, 5, 10, 9, 30);

function Live({ initial }: { initial: string }) {
	const [phrase, setPhrase] = useState(initial);
	return (
		<div className="max-w-md">
			<EventQuickEntry
				value={phrase}
				onChange={setPhrase}
				parse={parseEventPhrase(phrase, NOW)}
				onCommit={() => {}}
			/>
		</div>
	);
}

/** Type into it. Every keystroke moves the reading below the field. */
export const Typing: Story = {
	render: () => <Live initial="lunch with Jane friday 1pm" />,
};

/** A length in the phrase is read; without one the reader says it picked an hour. */
export const WithLength: Story = {
	render: () => <Live initial="dentist next tuesday 15:00 for 45m" />,
};

/** No time in the sentence, so no time in the event — and it says so. */
export const MissingTime: Story = {
	render: () => <Live initial="design review monday" />,
};

/** Nothing typed yet: the reading stays out of the way until there is one. */
export const Empty: Story = {
	render: () => <Live initial="" />,
};
