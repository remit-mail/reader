import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	type AddressEntry,
	ComposeAddressField,
	type ComposeAddressFieldHandle,
	type ParsedAddressInput,
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

const notAnAddress = (text: string) =>
	`To holds "${text}", which is not an address.`;

/**
 * A press elsewhere is what an address typed and left in the field has to
 * survive, and this is the shape the composer holds the field in for it.
 *
 * The press reads the field through `commitPending`, in the same tick, rather
 * than the list the field has got round to committing — the blur timer is still
 * 150 ms away from that. What the button says before it is pressed comes from
 * `onPendingChange`, so neither refusal ever stands while an address is on
 * screen, and text that is not an address stops the send instead of leaving
 * with it.
 */
const SendHarness = ({ initial = [] }: { initial?: AddressEntry[] }) => {
	const [addresses, setAddresses] = useState<AddressEntry[]>(initial);
	const [pending, setPending] = useState<ParsedAddressInput>({
		entries: [],
		unparsed: "",
	});
	const [sentTo, setSentTo] = useState<string[] | undefined>(undefined);
	const [refusal, setRefusal] = useState<string | undefined>(undefined);
	const field = useRef<ComposeAddressFieldHandle>(null);

	const refuse = (committed: ParsedAddressInput["unparsed"], count: number) => {
		if (committed.trim()) return notAnAddress(committed.trim());
		if (count === 0) return NO_RECIPIENT_REFUSAL;
		return undefined;
	};

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
					const beforePress = refuse(
						pending.unparsed,
						addresses.length + pending.entries.length,
					);
					if (beforePress !== undefined) {
						setRefusal(beforePress);
						return;
					}
					const committed = field.current?.commitPending();
					const recipients = committed?.addresses ?? addresses;
					const onPress = refuse(committed?.unparsed ?? "", recipients.length);
					if (onPress !== undefined) {
						setRefusal(onPress);
						return;
					}
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

/** A pasted list arrives in one onChange and never sees the comma keydown. */
export const SendTakesAPastedList: Story = {
	render: () => <SendHarness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByLabelText("To:"));
		await userEvent.paste("alice@northwind.example, bob@northwind.example");
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("sent-to")).toHaveTextContent(
			"alice@northwind.example, bob@northwind.example",
		);
	},
};

/**
 * Text that is not an address stops the send and is quoted back. Going ahead
 * would deliver the message to everyone but the person that text was for, and
 * the composer closing on it would take the text away unread.
 */
export const SendRefusesTextThatIsNotAnAddress: Story = {
	render: () => (
		<SendHarness initial={[{ email: "chipped@northwind.example" }]} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText<HTMLInputElement>("To:");
		await userEvent.type(input, "alice@northwind");
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));

		await expect(canvas.getByTestId("refusal")).toHaveTextContent(
			notAnAddress("alice@northwind"),
		);
		await expect(canvas.queryByTestId("sent-to")).not.toBeInTheDocument();
		await expect(input).toHaveValue("alice@northwind");
	},
};

/**
 * Candidates a complete address is a substring of, so the typed text is itself
 * committable and the suggestion picked is somebody else. That is what makes
 * the story below a claim about the blur timer rather than about deduplication.
 */
const NEARBY: AddressEntry[] = [
	{ email: "beta@northwind.example", displayName: "Beta Team" },
	{ email: "a@northwind.example.org", displayName: "Alpha Team" },
];

/**
 * The other press the field has to survive, and the reason the blur commit is
 * still on a timer: a click travelling towards a suggestion must not be answered
 * by the typed text becoming a chip and the list going with it.
 */
export const SuggestionSurvivesTheBlurItCauses: Story = {
	render: () => <Harness candidates={NEARBY} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText<HTMLInputElement>("To:");
		await userEvent.type(input, "a@northwind.example");
		const list = await canvas.findByRole("listbox");
		await userEvent.click(within(list).getByText("Beta Team"));

		await expect(canvas.getByText("Beta Team")).toBeVisible();
		await expect(input).toHaveValue("");

		// Past the blur timer, not merely past the click: the commit it scheduled
		// is cancelled, so the address that was typed never becomes a second chip.
		await new Promise((resolve) => setTimeout(resolve, 400));
		await expect(
			canvas.getAllByRole("button", { name: /^Remove / }),
		).toHaveLength(1);
		await expect(
			canvas.queryByText("a@northwind.example"),
		).not.toBeInTheDocument();
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
