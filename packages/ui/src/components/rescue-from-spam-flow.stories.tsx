import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button.js";
import type { MoveMailboxOption } from "./move-mailbox-picker.js";
import type { RescueCandidate } from "./rescue-candidate-row.js";
import { RescueFromSpamFlow } from "./rescue-from-spam-flow.js";

const meta: Meta<typeof RescueFromSpamFlow> = {
	title: "Flows/RescueFromSpamFlow",
	component: RescueFromSpamFlow,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[680px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof RescueFromSpamFlow>;

const CANDIDATES: RescueCandidate[] = [
	{
		id: "c1",
		senderName: "Anna de Vries",
		senderAddress: "anna@studio-noord.nl",
		subject: "Re: invoice for the September shoot",
		snippet: "Thanks for the quick turnaround — final files attached.",
		trustReason: "We can verify this sender",
		trustSubReason: "You've emailed them before",
		senderTrust: "wellknown",
	},
	{
		id: "c2",
		senderName: "Mum",
		senderAddress: "mum@gmail.com",
		subject: "dinner sunday?",
		snippet: "Let me know if you and the kids are coming over this weekend.",
		trustReason: "We can verify this sender",
		trustSubReason: "A sender you know",
		senderTrust: "vip",
	},
	{
		id: "c3",
		senderName: "Huisarts Centrum Oost",
		senderAddress: "no-reply@hcoost.nl",
		subject: "Afspraakbevestiging — 3 juli 09:20",
		snippet: "This confirms your appointment. Reply STOP to cancel.",
		trustReason: "We can verify this sender",
		trustSubReason: "You've emailed them before",
		senderTrust: "wellknown",
	},
];

const FOLDERS: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox" },
	{ id: "spam", label: "Spam", isCurrent: true },
	{ id: "receipts", label: "Receipts" },
	{ id: "family", label: "Family" },
	{ id: "work", label: "Work", searchValue: "work clients projects" },
];

function Demo() {
	const [open, setOpen] = useState(true);
	return (
		<div className="relative h-full overflow-hidden bg-surface">
			{!open && (
				<Button
					variant="primary"
					onClick={() => setOpen(true)}
					className="absolute inset-x-0 bottom-0 m-3 h-11 font-semibold"
				>
					Open rescue
				</Button>
			)}
			<RescueFromSpamFlow
				open={open}
				candidates={CANDIDATES}
				defaultDestinationId="inbox"
				availableFolders={FOLDERS}
				onConfirmMove={() => {}}
				onCancel={() => setOpen(false)}
			/>
		</div>
	);
}

export const Default: Story = {
	render: () => <Demo />,
};
