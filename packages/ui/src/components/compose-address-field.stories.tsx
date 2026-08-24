import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	type AddressEntry,
	ComposeAddressField,
	type ComposeAddressFieldHandle,
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

const NO_RECIPIENT_REFUSAL = "Add a To address before sending.";

/**
 * A press elsewhere is what an address typed and left in the field has to
 * survive, and this is the shape the composer holds the field in for it.
 *
 * The press reads the field through `commitPending`, in the same tick, rather
 * than the list the field has got round to committing — the blur timer is still
 * 150 ms away from that. What the button says before it is pressed comes from
 * `onPendingChange`, so a refusal for having no recipient never stands while
 * one is on screen.
 */
const SendHarness = ({ initial = [] }: { initial?: AddressEntry[] }) => {
	const [addresses, setAddresses] = useState<AddressEntry[]>(initial);
	const [pending, setPending] = useState<AddressEntry | undefined>(undefined);
	const [sentTo, setSentTo] = useState<string[] | undefined>(undefined);
	const [refusal, setRefusal] = useState<string | undefined>(undefined);
	const field = useRef<ComposeAddressFieldHandle>(null);

	const blocked =
		addresses.length + (pending ? 1 : 0) === 0
			? NO_RECIPIENT_REFUSAL
			: undefined;

	return (
		<div className="w-[520px]">
			<ComposeAddressField
				label="To"
				addresses={addresses}
				onChange={setAddresses}
				placeholder="Recipients"
				onPendingChange={setPending}
				ref={field}
			/>
			<button
				type="button"
				onClick={() => {
					if (blocked !== undefined) {
						setRefusal(blocked);
						return;
					}
					const recipients = field.current?.commitPending() ?? addresses;
					setSentTo(recipients.map((recipient) => recipient.email));
				}}
			>
				Send
			</button>
			{sentTo !== undefined && <p data-testid="sent-to">{sentTo.join(", ")}</p>}
			{refusal !== undefined && <p data-testid="refusal">{refusal}</p>}
		</div>
	);
};

export const SendTakesTheAddressStillInTheField: Story = {
	render: () => <SendHarness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("To:"),
			"typed@northwind.example",
		);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("sent-to")).toHaveTextContent(
			"typed@northwind.example",
		);
		await expect(canvas.queryByTestId("refusal")).not.toBeInTheDocument();
	},
};

/** With nothing typed and no chip there is nothing to send to, and it says so. */
export const SendRefusesAnEmptyField: Story = {
	render: () => <SendHarness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("refusal")).toHaveTextContent(
			NO_RECIPIENT_REFUSAL,
		);
	},
};

export const SendTakesTheAddressAfterAChip: Story = {
	render: () => (
		<SendHarness initial={[{ email: "chipped@northwind.example" }]} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("To:"),
			"typed@northwind.example",
		);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("sent-to")).toHaveTextContent(
			"chipped@northwind.example, typed@northwind.example",
		);
	},
};

/**
 * The other press the field has to survive, and the reason the blur commit is
 * still on a timer: a click travelling towards a suggestion must not be answered
 * by the typed text becoming a chip and the list going with it.
 */
export const SuggestionSurvivesTheBlurItCauses: Story = {
	render: () => <Harness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText<HTMLInputElement>("To:");
		await userEvent.type(input, "grace@northwind.example");
		const list = await canvas.findByRole("listbox");
		await userEvent.click(within(list).getByText("Grace Hopper"));

		await expect(canvas.getByText("Grace Hopper")).toBeVisible();
		await expect(input).toHaveValue("");
		// The blur the click caused still has its commit to run. It finds an empty
		// field and leaves the one chip the suggestion made.
		await waitFor(() =>
			expect(canvas.getAllByRole("button", { name: /^Remove / })).toHaveLength(
				1,
			),
		);
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
