import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	type AddressEntry,
	ComposeAddressField,
} from "./compose-address-field.js";

const KNOWN: AddressEntry[] = [
	{ email: "ada@northwind.example", displayName: "Ada Lovelace" },
	{ email: "grace@northwind.example", displayName: "Grace Hopper" },
	{ email: "ops@northwind.example" },
];

/**
 * Recipients as chips, with a typeahead over the addresses the account already
 * knows. Nothing here fetches: the app hands the candidates in and is told what
 * has been typed, which is what makes the empty-result story below the same
 * component the app renders.
 */
const meta: Meta<typeof ComposeAddressField> = {
	title: "Mail/ComposeAddressField",
	component: ComposeAddressField,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ComposeAddressField>;

const Harness = ({
	initial = [],
	candidates = KNOWN,
	label = "To",
}: {
	initial?: AddressEntry[];
	candidates?: AddressEntry[];
	label?: string;
}) => {
	const [addresses, setAddresses] = useState<AddressEntry[]>(initial);
	const [query, setQuery] = useState("");
	const suggestions = candidates.filter((candidate) =>
		`${candidate.displayName ?? ""} ${candidate.email}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	);

	return (
		<div className="w-[520px]">
			<ComposeAddressField
				label={label}
				addresses={addresses}
				onChange={setAddresses}
				placeholder="Recipients"
				suggestions={query.length >= 2 ? suggestions : []}
				onQueryChange={setQuery}
			/>
		</div>
	);
};

export const Empty: Story = {
	name: "Empty — the placeholder is the only content",
	render: () => <Harness />,
};

export const WithRecipients: Story = {
	render: () => (
		<Harness
			initial={[
				{ email: "ada@northwind.example", displayName: "Ada Lovelace" },
				{ email: "ops@northwind.example" },
			]}
		/>
	),
};

export const SuggestionsOffered: Story = {
	render: () => <Harness />,
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByLabelText("To:");
		await userEvent.type(input, "ada");
		const list = await within(canvasElement).findByRole("listbox");
		await expect(within(list).getByText("Ada Lovelace")).toBeVisible();
		await userEvent.click(within(list).getByText("Ada Lovelace"));
		await expect(
			within(canvasElement).getByText("Ada Lovelace"),
		).toBeInTheDocument();
	},
};

/**
 * Nothing matches. The field stays a plain text field — an address the account
 * has never written to is still a valid address, and typing it out is the
 * normal case, not a failure.
 */
export const NoMatches: Story = {
	render: () => <Harness candidates={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText("To:");
		await userEvent.type(input, "someone@elsewhere.example{enter}");
		await expect(canvas.queryByRole("listbox")).not.toBeInTheDocument();
		await expect(canvas.getByText("someone@elsewhere.example")).toBeVisible();
	},
};

/** What is not an address stays in the field rather than becoming a chip. */
export const IncompleteAddressIsNotTaken: Story = {
	render: () => <Harness candidates={[]} />,
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByLabelText<HTMLInputElement>("To:");
		await userEvent.type(input, "not-an-address{enter}");
		await expect(input).toHaveValue("not-an-address");
	},
};

export const BackspaceRemovesTheLastChip: Story = {
	render: () => (
		<Harness
			initial={[
				{ email: "ada@northwind.example", displayName: "Ada Lovelace" },
				{ email: "ops@northwind.example" },
			]}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText("To:");
		await userEvent.click(input);
		await userEvent.keyboard("{Backspace}");
		await waitFor(() =>
			expect(
				canvas.queryByText("ops@northwind.example"),
			).not.toBeInTheDocument(),
		);
		await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
	},
};
