import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type SearchChip, SearchChipInput } from "./search-chip-input.js";

const meta: Meta<typeof SearchChipInput> = {
	title: "Mail/SearchChipInput",
	component: SearchChipInput,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof SearchChipInput>;

/**
 * Chips are host-owned, exactly as in Gmail: the product commits them (the
 * folder you are viewing, a filter panel, a suggestion) and typed text stays
 * text. The "Add filter" buttons here stand in for that structured intent so
 * the chip lifecycle is exercisable in isolation.
 */
const Interactive = ({
	initialChips = [],
	initialValue = "",
	size = "sm",
	offer = [],
}: {
	initialChips?: SearchChip[];
	initialValue?: string;
	size?: "sm" | "lg";
	offer?: SearchChip[];
}) => {
	const [chips, setChips] = useState<SearchChip[]>(initialChips);
	const [value, setValue] = useState(initialValue);
	const unused = offer.filter(
		(c) => !chips.some((existing) => existing.id === c.id),
	);

	return (
		<div className="flex w-full max-w-2xl flex-col gap-3">
			<SearchChipInput
				chips={chips}
				onRemoveChip={(id) => setChips((cs) => cs.filter((c) => c.id !== id))}
				value={value}
				onChange={setValue}
				onClear={() => {
					setValue("");
					setChips([]);
				}}
				onClearQuery={() => setValue("")}
				globalFocusKey={false}
				size={size}
			/>
			{unused.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-2xs text-fg-subtle">Add filter:</span>
					{unused.map((chip) => (
						<button
							key={chip.id}
							type="button"
							onClick={() => setChips((cs) => [...cs, chip])}
							className="rounded-full border border-line px-2 py-0.5 text-2xs text-fg-muted hover:bg-surface"
						>
							{chip.label}
						</button>
					))}
				</div>
			)}
			<p className="text-2xs text-fg-subtle">
				Caret at the start of the text: Backspace selects the last chip, a
				second Backspace removes it. ArrowLeft selects; typing returns to the
				text.
			</p>
		</div>
	);
};

const OFFER: SearchChip[] = [
	{ id: "in:spam", label: "in:spam" },
	{ id: "from:acme", label: "from:acme" },
	{ id: "has:attachment", label: "has:attachment" },
	{ id: "is:unread", label: "is:unread" },
];

/** Unscoped — the daily brief's state: no chips, search reads across everything. */
export const Unscoped: Story = {
	render: () => <Interactive offer={OFFER} />,
};

/** One narrowing chip, the shape the sidebar prefills when you open Spam. */
export const OneChip: Story = {
	render: () => (
		<Interactive
			initialChips={[{ id: "in:spam", label: "in:spam" }]}
			offer={OFFER}
		/>
	),
};

/** A chip and free text together — one expression, read left to right. */
export const ChipWithText: Story = {
	render: () => (
		<Interactive
			initialChips={[{ id: "in:spam", label: "in:spam" }]}
			initialValue="invoice"
			offer={OFFER}
		/>
	),
};

/** Several chips: the field scrolls rather than growing taller. */
export const MultipleChips: Story = {
	render: () => (
		<Interactive
			initialChips={[
				{ id: "in:spam", label: "in:spam" },
				{ id: "from:acme", label: "from:acme" },
				{ id: "has:attachment", label: "has:attachment" },
			]}
			initialValue="refund"
			offer={OFFER}
		/>
	),
};

/**
 * A typed operator stays plain text — it only becomes a chip when the product
 * commits it. Both are visible here: `in:spam` as a chip, `from:bob` as text.
 */
export const TypedOperatorStaysText: Story = {
	render: () => (
		<Interactive
			initialChips={[{ id: "in:spam", label: "in:spam" }]}
			initialValue="from:bob receipt"
			offer={OFFER}
		/>
	),
};

/** The taller field the global top bar uses. */
export const LargeForTopBar: Story = {
	render: () => (
		<Interactive
			size="lg"
			initialChips={[{ id: "in:spam", label: "in:spam" }]}
			offer={OFFER}
		/>
	),
};

/** Chip selected — the state a first Backspace leaves the field in. */
export const ChipSelected: Story = {
	render: () => (
		<Interactive
			initialChips={[{ id: "in:spam", label: "in:spam" }]}
			offer={OFFER}
		/>
	),
	play: async ({ canvasElement }) => {
		const input = canvasElement.querySelector<HTMLInputElement>("#mail-search");
		input?.focus();
		input?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);
	},
};
