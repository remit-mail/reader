import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import { NewFolderForm } from "./new-folder-form.js";

const meta: Meta<typeof NewFolderForm> = {
	title: "Mail/NewFolderForm",
	component: NewFolderForm,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof NewFolderForm>;

function Frame({ children }: { children: ReactNode }) {
	return (
		<div className="w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg">
			{children}
		</div>
	);
}

function Form({
	parentLabel = "Travel",
	initialName = "",
	pending,
	error,
}: {
	parentLabel?: string;
	initialName?: string;
	pending?: boolean;
	error?: string;
}) {
	const [name, setName] = useState(initialName);
	return (
		<Frame>
			<NewFolderForm
				parentLabel={parentLabel}
				name={name}
				onNameChange={setName}
				onSubmit={() => undefined}
				onCancel={() => undefined}
				pending={pending}
				error={error}
			/>
		</Frame>
	);
}

export const Empty: Story = {
	name: "Opened, waiting for a name",
	render: () => <Form />,
};

export const TopLevel: Story = {
	name: "At the top level",
	render: () => <Form parentLabel="Top level" initialName="Insurance" />,
};

/** Creating a folder is an IMAP mutation: the form holds until the server confirms. */
export const Pending: Story = {
	name: "Waiting for the server",
	render: () => <Form initialName="Car hire" pending />,
};

/** The failure is stated where it happened; the form stays open to retry. */
export const Failed: Story = {
	name: "Failed (retry in place)",
	render: () => (
		<Form
			initialName="Car hire"
			error="The mail server refused the folder name. Try another one."
		/>
	),
};
