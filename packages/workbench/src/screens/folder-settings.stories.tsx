import {
	FolderManager,
	FolderRenameDialog,
	type FolderRole,
	FolderRolesHelp,
	type FolderTreeNode,
	type ManagedFolder,
	type RoleAppointment,
	RoleAppointmentList,
	type SettingsNavItem,
	SettingsShell,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Filter,
	FolderTree,
	Inbox,
	Palette,
	Users,
	Wrench,
} from "lucide-react";
import { useState } from "react";

const meta: Meta = {
	title: "Screens/Folder settings",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const navItems: SettingsNavItem[] = [
	{ id: "accounts", label: "Accounts", icon: <Inbox className="size-4" /> },
	{
		id: "senders",
		label: "Senders & Rules",
		icon: <Users className="size-4" />,
	},
	{
		id: "folders",
		label: "Folder roles",
		icon: <FolderTree className="size-4" />,
	},
	{ id: "filters", label: "Filters", icon: <Filter className="size-4" /> },
	{
		id: "appearance",
		label: "Appearance",
		icon: <Palette className="size-4" />,
	},
	{ id: "advanced", label: "Advanced", icon: <Wrench className="size-4" /> },
];

const ACCOUNT_EMAIL = "alice@northwind.example";

const initialFolders: ManagedFolder[] = [
	{
		id: "mbx-inbox",
		label: "Inbox",
		path: "INBOX",
		deleteBlockedReason: "The inbox can't be deleted.",
	},
	{
		id: "mbx-archive",
		label: "Archive",
		path: "INBOX/Archief",
		deleteBlockedReason:
			"This folder is your Archive folder. Reassign that role before deleting it.",
	},
	{
		id: "mbx-junk",
		label: "Spam",
		path: "INBOX/Ongewenst",
		deleteBlockedReason:
			"This folder is your Junk folder. Reassign that role before deleting it.",
	},
	// Trash here is `Proposed` — a name match nobody confirmed, so it deletes
	// like any other folder while Archive (Appointed) and Spam (Flagged) refuse.
	{ id: "mbx-trash", label: "Trash", path: "INBOX/Prullenbak" },
	{
		id: "mbx-travel",
		label: "Travel",
		path: "INBOX/Travel",
		deleteBlockedReason: "This folder has subfolders. Delete them first.",
	},
	{ id: "mbx-flights", label: "Flights", path: "INBOX/Travel/Flights" },
	{ id: "mbx-hotels", label: "Hotels", path: "INBOX/Travel/Hotels" },
	{ id: "mbx-receipts", label: "Receipts", path: "INBOX/Travel/Receipts" },
	{
		id: "mbx-finance",
		label: "Finance",
		path: "INBOX/Finance",
		deleteBlockedReason: "This folder has subfolders. Delete them first.",
	},
	{ id: "mbx-invoices", label: "Invoices", path: "INBOX/Finance/Invoices" },
	{ id: "mbx-tax", label: "Tax", path: "INBOX/Finance/Tax" },
	{ id: "mbx-family", label: "Family", path: "INBOX/Family" },
	{
		id: "mbx-news",
		label: "Newsletters",
		path: "INBOX/Newsletters",
		deleteBlockedReason: "This folder has subfolders. Delete them first.",
	},
	{ id: "mbx-news-tech", label: "Tech", path: "INBOX/Newsletters/Tech" },
];

const messageCounts: Record<string, number> = {
	"mbx-inbox": 1240,
	"mbx-archive": 8130,
	"mbx-junk": 62,
	"mbx-trash": 17,
	"mbx-travel": 0,
	"mbx-flights": 41,
	"mbx-hotels": 96,
	"mbx-receipts": 12,
};

const initialAppointments: Record<string, RoleAppointment> = {
	inbox: { mailboxId: "mbx-inbox", source: "Reserved" },
	drafts: { mailboxId: null, source: "None" },
	sent: { mailboxId: null, source: "None" },
	archive: { mailboxId: "mbx-archive", source: "Appointed" },
	junk: { mailboxId: "mbx-junk", source: "Flagged" },
	trash: { mailboxId: "mbx-trash", source: "Proposed" },
};

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

function FolderSettingsPage({ renaming = false }: { renaming?: boolean }) {
	const [helpOpen, setHelpOpen] = useState(true);
	const [folders, setFolders] = useState(initialFolders);
	const [appointments, setAppointments] = useState(initialAppointments);
	const [renamed, setRenamed] = useState<ManagedFolder | null>(
		renaming ? (initialFolders[4] as ManagedFolder) : null,
	);
	const [draft, setDraft] = useState("Travel");

	const handleAppoint = (role: FolderRole, mailboxId: string | null) =>
		setAppointments((current) => {
			const next: Record<string, RoleAppointment> = {
				...current,
				[role]: mailboxId
					? { mailboxId, source: "Appointed" }
					: { mailboxId: null, source: "None" },
			};
			for (const other of Object.keys(next)) {
				if (other === role) continue;
				if (!mailboxId || next[other]?.mailboxId !== mailboxId) continue;
				next[other] = { mailboxId: null, source: "None" };
			}
			return next;
		});

	return (
		<SettingsShell
			items={navItems}
			activeId="folders"
			title="Folder roles"
			description="Appoint which real folder fills each canonical role, per account."
			help={<FolderRolesHelp />}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((open) => !open)}
			onBackToMail={() => undefined}
		>
			<div className="space-y-4">
				<RoleAppointmentList
					accountEmail={ACCOUNT_EMAIL}
					folders={folders.map((folder) => ({
						mailboxId: folder.id,
						providerPath: folder.path,
						hierarchyDelimiter: "/",
						messageCount: messageCounts[folder.id] ?? 0,
					}))}
					appointments={appointments}
					displayNames={{}}
					onAppoint={handleAppoint}
					onRename={() => {}}
				/>
				<section className="space-y-1.5">
					<h3 className="text-sm font-semibold text-fg">
						Your folders — {ACCOUNT_EMAIL}
					</h3>
					<div className="flex h-[28rem] flex-col overflow-hidden rounded-sm border border-line bg-surface">
						<FolderManager
							folders={folders}
							onCreateFolder={(name, parentPath) =>
								createFolder(name, parentPath).then((created) => {
									setFolders((current) => [...current, created]);
									return created;
								})
							}
							onRename={(folder) => {
								setRenamed(folder);
								setDraft(folder.label);
							}}
							onDelete={(folder) =>
								setFolders((current) =>
									current.filter((entry) => entry.id !== folder.id),
								)
							}
							labels={{ treeAriaLabel: `All folders for ${ACCOUNT_EMAIL}` }}
						/>
					</div>
				</section>
			</div>
			{renamed && (
				<FolderRenameDialog
					open
					folderLabel={renamed.label}
					defaultLabel={renamed.path.split("/").pop() ?? renamed.label}
					name={draft}
					onNameChange={setDraft}
					onSubmit={() => setRenamed(null)}
					onClose={() => setRenamed(null)}
				/>
			)}
		</SettingsShell>
	);
}

/**
 * Folder settings on desktop: the roles above, then the account's real
 * hierarchy — browsed the same way a move destination is picked, with rename
 * and delete on each row.
 */
export const Desktop: Story = {
	globals: { viewport: { value: "desktop" } },
	render: () => <FolderSettingsPage />,
};

/** The same screen on a phone, where the tree owns the full width. */
export const Phone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <FolderSettingsPage />,
};

/** Renaming from a folder's own row. */
export const Renaming: Story = {
	globals: { viewport: { value: "desktop" } },
	render: () => <FolderSettingsPage renaming />,
};
