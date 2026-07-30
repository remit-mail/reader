import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import type { FolderTreeNode } from "../lib/folder-tree.js";
import { FolderManager, type ManagedFolder } from "./folder-manager.js";
import { FolderRenameDialog } from "./folder-rename-dialog.js";

const folders: ManagedFolder[] = [
	{
		id: "mbx-inbox",
		label: "Inbox",
		path: "INBOX",
		deleteBlockedReason: "The inbox can't be deleted.",
	},
	{
		id: "mbx-archive",
		label: "Archive",
		path: "Archive",
		deleteBlockedReason:
			"This folder is your Archive folder. Reassign that role before deleting it.",
	},
	{
		id: "mbx-trash",
		label: "Trash",
		path: "Deleted Messages",
		deleteBlockedReason:
			"This folder is your Trash folder. Reassign that role before deleting it.",
	},
	{
		id: "mbx-travel",
		label: "Travel",
		path: "Travel",
		deleteBlockedReason: "This folder has subfolders. Delete them first.",
	},
	{ id: "mbx-travel-flights", label: "Flights", path: "Travel/Flights" },
	{ id: "mbx-travel-hotels", label: "Hotels", path: "Travel/Hotels" },
	{
		id: "mbx-travel-hotels-receipts",
		label: "Receipts",
		path: "Travel/Hotels/Receipts",
	},
	{
		id: "mbx-finance",
		label: "Finance",
		path: "Finance",
		deleteBlockedReason: "This folder has subfolders. Delete them first.",
	},
	{ id: "mbx-finance-invoices", label: "Invoices", path: "Finance/Invoices" },
	{ id: "mbx-finance-tax", label: "Tax", path: "Finance/Tax" },
	{ id: "mbx-family", label: "Family", path: "Family" },
	{ id: "mbx-news", label: "Newsletters", path: "Newsletters" },
	{ id: "mbx-news-tech", label: "Tech", path: "Newsletters/Tech" },
];

const meta: Meta<typeof FolderManager> = {
	title: "Mail/FolderManager",
	component: FolderManager,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FolderManager>;

function Frame({
	children,
	className = "h-[520px] w-[420px] rounded-lg border border-line shadow-lg",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`flex flex-col overflow-hidden bg-surface font-sans text-fg ${className}`}
		>
			{children}
		</div>
	);
}

let createdSeq = 0;
const createFolder = (
	name: string,
	parentPath: string,
): Promise<FolderTreeNode> =>
	new Promise((resolve) => {
		createdSeq += 1;
		setTimeout(
			() =>
				resolve({
					id: `mbx-created-${createdSeq}`,
					label: name,
					path: parentPath ? `${parentPath}/${name}` : name,
				}),
			400,
		);
	});

function Manager({
	renaming = false,
	className,
}: {
	renaming?: boolean;
	className?: string;
}) {
	const [known, setKnown] = useState<ManagedFolder[]>(folders);
	const [renamed, setRenamed] = useState<ManagedFolder | null>(
		renaming ? (folders[2] as ManagedFolder) : null,
	);
	const [draft, setDraft] = useState("Trash");
	return (
		<>
			<Frame className={className}>
				<FolderManager
					folders={known}
					onCreateFolder={(name, parentPath) =>
						createFolder(name, parentPath).then((created) => {
							setKnown((current) => [...current, created]);
							return created;
						})
					}
					onRename={(folder) => {
						setRenamed(folder);
						setDraft(folder.label);
					}}
					onDelete={(folder) =>
						setKnown((current) =>
							current.filter((entry) => entry.id !== folder.id),
						)
					}
					labels={{ treeAriaLabel: "All folders for alice@northwind.example" }}
				/>
			</Frame>
			{renamed && (
				<FolderRenameDialog
					open
					folderLabel={renamed.label}
					defaultLabel="Deleted Messages"
					name={draft}
					onNameChange={setDraft}
					onSubmit={() => setRenamed(null)}
					onClose={() => setRenamed(null)}
				/>
			)}
		</>
	);
}

/**
 * The account's folders as they really nest, closed to the top level. Every row
 * opens where you tap it and carries rename and delete; a folder the account
 * depends on keeps rename and states why it stays.
 */
export const Default: Story = {
	name: "Default (collapsed to top level)",
	render: () => <Manager />,
};

/** Renaming a folder: the name is Remit's own, and clearing it restores the server's. */
export const Renaming: Story = {
	name: "Renaming a folder",
	render: () => <Manager renaming />,
};

/** A first-run account with nothing but its inbox. */
export const JustTheInbox: Story = {
	name: "A single folder",
	render: () => (
		<Frame>
			<FolderManager
				folders={[folders[0] as ManagedFolder]}
				onCreateFolder={createFolder}
				onRename={() => {}}
				onDelete={() => {}}
			/>
		</Frame>
	),
};

/** The surface as it sits on a phone: full width, one branch open at a time. */
export const Phone: Story = {
	name: "Phone",
	globals: { viewport: { value: "mobile" } },
	parameters: { layout: "fullscreen" },
	render: () => <Manager className="h-screen w-full" />,
};
