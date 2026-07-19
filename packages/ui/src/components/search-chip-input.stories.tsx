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
 * The field does not create chips — the host commits them from structured
 * intent (the view being navigated to, a filter menu, a suggestion). The "Add
 * filter" buttons below stand in for that host, so the chip lifecycle is
 * exercisable here in isolation.
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
			<p className="max-w-prose text-2xs leading-relaxed text-fg-subtle">
				One tab stop. From the text: Backspace or ArrowLeft at the very start
				moves onto the last chip, Shift+Tab steps back into the chips. On a
				chip: Backspace or Delete removes it, Left/Right walk the chips,
				ArrowRight past the last one returns to the text. After a removal focus
				lands on the chip that took its place, else the previous one, else the
				text.
			</p>
		</div>
	);
};

const SCOPE: SearchChip = { id: "in:spam", label: "in:spam", tone: "scope" };

const OFFER: SearchChip[] = [
	{ id: "from:acme", label: "from:acme" },
	{ id: "has:attachment", label: "has:attachment" },
	{ id: "is:unread", label: "is:unread" },
	{ id: "before:2026-01-01", label: "before:2026-01-01" },
];

/** Unscoped — the daily brief's state: no chips, search reads across everything. */
export const Unscoped: Story = {
	render: () => <Interactive offer={[SCOPE, ...OFFER]} />,
};

/**
 * One narrowing chip: the view the user navigated into. A scope carries a
 * different tint from a filter the user added, because it came from where they
 * are rather than from something they typed.
 */
export const OneChip: Story = {
	render: () => <Interactive initialChips={[SCOPE]} offer={OFFER} />,
};

/** A chip and free text together — one expression, read left to right. */
export const ChipWithText: Story = {
	render: () => (
		<Interactive initialChips={[SCOPE]} initialValue="invoice" offer={OFFER} />
	),
};

/** Several chips: they wrap onto the next line rather than clipping. */
export const MultipleChips: Story = {
	render: () => (
		<Interactive
			initialChips={[
				SCOPE,
				{ id: "from:acme", label: "from:acme" },
				{ id: "has:attachment", label: "has:attachment" },
				{ id: "before:2026-01-01", label: "before:2026-01-01" },
			]}
			initialValue="refund"
			offer={OFFER}
		/>
	),
};

/**
 * A typed operator stays plain text. Chipping only what the product committed
 * keeps the typed query honest — the text is exactly what the user typed, and
 * the field never has to guess what was meant as an operator.
 */
export const TypedOperatorStaysText: Story = {
	render: () => (
		<Interactive
			initialChips={[SCOPE]}
			initialValue="from:bob receipt"
			offer={OFFER}
		/>
	),
};

/** A long chip label truncates; its remove control stays reachable. */
export const LongChipLabel: Story = {
	render: () => (
		<Interactive
			initialChips={[
				{
					id: "from:long",
					label: "from:notifications-noreply@some-very-long-domain.example.com",
				},
			]}
			offer={OFFER}
		/>
	),
};

/** The taller field the global top bar uses. */
export const LargeForTopBar: Story = {
	render: () => <Interactive size="lg" initialChips={[SCOPE]} offer={OFFER} />,
};

/**
 * Focus resting on a chip — the state the first Backspace leaves the field in,
 * from which a second Backspace removes it.
 */
export const ChipFocused: Story = {
	render: () => <Interactive initialChips={[SCOPE]} offer={OFFER} />,
	play: async ({ canvasElement }) => {
		canvasElement
			.querySelector<HTMLButtonElement>('[role="row"] button')
			?.focus();
	},
};
