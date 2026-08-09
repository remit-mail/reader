import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
	type AddressEntry,
	ComposeAddressField,
} from "./compose-address-field.js";
import { ComposeHeader, composeHeaderSummary } from "./compose-header.js";
import { ComposeSubjectField } from "./compose-subject-field.js";

const FromRow = ({ email }: { email: string }) => (
	<div className="flex items-start gap-2">
		{/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label for a read-only value, not a form control */}
		<label className="text-sm text-fg-muted shrink-0 w-12 pt-1.5">From:</label>
		<div className="text-sm py-1.5">{email}</div>
	</div>
);

/**
 * Who the message is going to and what it is about. Cc and Bcc are not there
 * until they are asked for — the common message has one recipient line, and
 * three empty ones push the writing surface off a phone.
 */
const meta: Meta<typeof ComposeHeader> = {
	title: "Mail/ComposeHeader",
	component: ComposeHeader,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ComposeHeader>;

const Harness = ({
	initialTo = [],
	initialCc,
	initialBcc,
	initialSubject = "",
	collapsed = false,
}: {
	initialTo?: AddressEntry[];
	initialCc?: AddressEntry[];
	initialBcc?: AddressEntry[];
	initialSubject?: string;
	collapsed?: boolean;
}) => {
	const [to, setTo] = useState(initialTo);
	const [cc, setCc] = useState(initialCc ?? []);
	const [bcc, setBcc] = useState(initialBcc ?? []);
	const [showCc, setShowCc] = useState(initialCc !== undefined);
	const [showBcc, setShowBcc] = useState(initialBcc !== undefined);
	const [subject, setSubject] = useState(initialSubject);
	const [isCollapsed, setIsCollapsed] = useState(collapsed);

	return (
		<div className="w-[560px] border border-line bg-surface">
			<ComposeHeader
				collapsed={isCollapsed}
				onExpand={() => setIsCollapsed(false)}
				summary={composeHeaderSummary({ to, cc, bcc, subject })}
				from={<FromRow email="alice@northwind.example" />}
				to={
					<ComposeAddressField
						label="To"
						addresses={to}
						onChange={setTo}
						placeholder="Recipients"
					/>
				}
				cc={
					showCc ? (
						<ComposeAddressField label="Cc" addresses={cc} onChange={setCc} />
					) : undefined
				}
				bcc={
					showBcc ? (
						<ComposeAddressField
							label="Bcc"
							addresses={bcc}
							onChange={setBcc}
						/>
					) : undefined
				}
				subject={<ComposeSubjectField value={subject} onChange={setSubject} />}
				onShowCc={() => setShowCc(true)}
				onShowBcc={() => setShowBcc(true)}
			/>
		</div>
	);
};

export const NewMessage: Story = {
	name: "New message — nothing filled in",
	render: () => <Harness />,
};

export const Reply: Story = {
	render: () => (
		<Harness
			initialTo={[{ email: "ada@northwind.example", displayName: "Ada" }]}
			initialSubject="Re: Q3 planning"
		/>
	),
};

export const CcAndBccRevealed: Story = {
	render: () => (
		<Harness
			initialTo={[{ email: "ada@northwind.example", displayName: "Ada" }]}
			initialCc={[{ email: "grace@northwind.example" }]}
			initialBcc={[]}
			initialSubject="Re: Q3 planning"
		/>
	),
};

/**
 * The software keyboard is up on a phone. The header gives its space to the
 * writing surface and keeps one line of what is already filled in.
 */
export const Collapsed: Story = {
	render: () => (
		<Harness
			collapsed
			initialTo={[
				{ email: "ada@northwind.example", displayName: "Ada Lovelace" },
			]}
			initialCc={[{ email: "grace@northwind.example" }]}
			initialSubject="Re: Q3 planning"
		/>
	),
};

/** Collapsed before anything is typed: an ellipsis, not an empty bar. */
export const CollapsedAndEmpty: Story = {
	render: () => <Harness collapsed />,
};

/**
 * The collapsed line is the way back. Pressing it puts the recipient rows
 * back — with the keyboard up it is the only route to Cc, Bcc and the subject,
 * and a bar that looks pressable and is not reads as a broken app.
 */
export const CollapsedExpandsOnPress: Story = {
	render: () => (
		<Harness
			collapsed
			initialTo={[
				{ email: "ada@northwind.example", displayName: "Ada Lovelace" },
			]}
			initialSubject="Re: Q3 planning"
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Show recipients and subject" }),
		);
		await expect(canvas.getByLabelText("To:")).toBeVisible();
	},
};

export const RevealingCcLeavesBccOnOffer: Story = {
	render: () => <Harness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByLabelText("Cc:")).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Cc" }));
		await expect(canvas.getByLabelText("Cc:")).toBeVisible();
		await expect(canvas.queryByLabelText("Bcc:")).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Bcc" }));
		await expect(canvas.getByLabelText("Bcc:")).toBeVisible();
	},
};
