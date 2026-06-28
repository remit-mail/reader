import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	RescueCandidateRow,
	type RescueCandidateRowProps,
} from "./rescue-candidate-row.js";

const meta: Meta<typeof RescueCandidateRow> = {
	title: "Components/RescueCandidateRow",
	component: RescueCandidateRow,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md divide-y divide-line rounded-xl border border-line bg-surface">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof RescueCandidateRow>;

const base: RescueCandidateRowProps["candidate"] = {
	id: "1",
	senderName: "Anna de Vries",
	senderAddress: "anna@studio-noord.nl",
	subject: "Re: invoice for the September shoot",
	snippet: "Thanks for the quick turnaround — final files attached as agreed.",
	trustReason: "We can verify this sender",
	trustSubReason: "You've emailed them before",
	senderTrust: "wellknown",
};

function Interactive(props: {
	candidate: RescueCandidateRowProps["candidate"];
}) {
	const [selected, setSelected] = useState(true);
	return (
		<RescueCandidateRow
			candidate={props.candidate}
			selected={selected}
			onToggle={() => setSelected((v) => !v)}
		/>
	);
}

export const Selected: Story = {
	render: () => <Interactive candidate={base} />,
};

export const KnownContact: Story = {
	render: () => <Interactive candidate={base} />,
};

export const PassedAuthentication: Story = {
	render: () => (
		<Interactive
			candidate={{
				...base,
				id: "2",
				senderName: "GitHub",
				senderAddress: "noreply@github.com",
				subject: "[remit] CI passed on rescue-from-spam",
				snippet: "All checks have passed on your pull request.",
				trustReason: "We can verify this sender",
				trustSubReason: "Passed authentication",
				senderTrust: undefined,
			}}
		/>
	),
};

export const KnownMailingList: Story = {
	render: () => (
		<Interactive
			candidate={{
				...base,
				id: "3",
				senderName: "Stripe Weekly",
				senderAddress: "weekly@stripe.com",
				subject: "Your payouts this week",
				snippet: "Here is a summary of the payouts settled to your account.",
				trustReason: "We can verify this sender",
				trustSubReason: "Known mailing list you read",
				senderTrust: undefined,
			}}
		/>
	),
};

export const Vip: Story = {
	render: () => (
		<Interactive
			candidate={{
				...base,
				id: "4",
				senderName: "Mum",
				senderAddress: "mum@gmail.com",
				subject: "dinner sunday?",
				snippet: "Let me know if you and the kids are coming over.",
				trustReason: "We can verify this sender",
				trustSubReason: "Someone you email often",
				senderTrust: "vip",
			}}
		/>
	),
};
