import type { Meta, StoryObj } from "@storybook/react";
import type { NavAccount } from "./app-shell-types.js";
import { NavSidebar } from "./nav-sidebar.js";

const accounts: NavAccount[] = [
	{
		id: "acct-personal",
		label: "Personal",
		email: "matthijs@example.com",
		outboxPending: 2,
		mailboxes: [
			{ id: "personal-inbox", name: "Inbox", role: "inbox", unseen: 12 },
			{ id: "personal-sent", name: "Sent", role: "sent" },
			{ id: "personal-archive", name: "Archive", role: "archive" },
			{ id: "personal-trash", name: "Trash", role: "trash" },
			{ id: "personal-receipts", name: "Receipts", unseen: 3 },
			{ id: "personal-travel", name: "Travel" },
		],
	},
	{
		id: "acct-work",
		label: "Work",
		email: "matthijs@work.example",
		outboxPending: 0,
		mailboxes: [
			{ id: "work-inbox", name: "Inbox", role: "inbox", unseen: 4 },
			{ id: "work-sent", name: "Sent", role: "sent" },
			{ id: "work-trash", name: "Trash", role: "trash" },
		],
	},
];

const manyFoldersAccount: NavAccount = {
	id: "acct-archivist",
	label: "Archivist",
	email: "archivist@example.com",
	mailboxes: [
		{ id: "arch-inbox", name: "Inbox", role: "inbox", unseen: 1 },
		{ id: "arch-sent", name: "Sent", role: "sent" },
		{ id: "arch-trash", name: "Trash", role: "trash" },
		{ id: "arch-clients", name: "Clients" },
		{ id: "arch-invoices", name: "Invoices" },
		{ id: "arch-projects", name: "Projects" },
		{ id: "arch-newsletters", name: "Newsletters" },
		{ id: "arch-receipts", name: "Receipts" },
		{ id: "arch-travel", name: "Travel" },
		{ id: "arch-legal", name: "Legal" },
		{ id: "arch-taxes", name: "Taxes" },
		{ id: "arch-misc", name: "Misc" },
		{ id: "arch-2019", name: "2019" },
		{ id: "arch-2020", name: "2020" },
	],
};

const meta: Meta<typeof NavSidebar> = {
	title: "Screens/Kit/NavSidebar",
	component: NavSidebar,
	parameters: { layout: "fullscreen" },
	args: {
		accounts,
		briefUnseen: 7,
		onSelectNav: () => undefined,
	},
	render: (args) => (
		<div className="h-screen w-64 border-r border-line">
			<NavSidebar {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof NavSidebar>;

export const Default: Story = { args: { selectedNavId: "personal-inbox" } };

export const Brief: Story = { args: { selectedNavId: "brief" } };

export const Flagged: Story = { args: { selectedNavId: "flagged" } };

export const ManyFolders: Story = {
	args: {
		accounts: [manyFoldersAccount],
		selectedNavId: "arch-inbox",
	},
};

/**
 * A Hostnet-shaped account: every folder is nested under the "INBOX/" personal
 * namespace and only Spam carries a SPECIAL-USE flag, yet the adapter resolves
 * roles + canonical labels so the kit still pins Inbox/Drafts/Sent/Archive/
 * Spam/Trash and shows the real "Nieuwsbrieven" user folder under Folders.
 */
const hostnetAccount: NavAccount = {
	id: "acct-hostnet",
	label: "Hostnet",
	email: "440737+mvhenten@users.noreply.github.com",
	mailboxes: [
		{
			id: "hn-inbox",
			name: "Inbox",
			role: "inbox",
			fullPath: "INBOX",
			unseen: 8,
		},
		{
			id: "hn-drafts",
			name: "Drafts",
			role: "drafts",
			fullPath: "INBOX/Drafts",
		},
		{ id: "hn-sent", name: "Sent", role: "sent", fullPath: "INBOX/Sent" },
		{
			id: "hn-archive",
			name: "Archive",
			role: "archive",
			fullPath: "INBOX/Archive",
		},
		{
			id: "hn-spam",
			name: "Spam",
			role: "junk",
			fullPath: "INBOX/Spam",
			unseen: 3,
		},
		{
			id: "hn-trash",
			name: "Trash",
			role: "trash",
			fullPath: "INBOX/Deleted Messages",
		},
		{
			id: "hn-news",
			name: "Nieuwsbrieven",
			fullPath: "INBOX/Nieuwsbrieven",
			unseen: 2,
		},
	],
};

export const Hostnet: Story = {
	args: {
		accounts: [hostnetAccount],
		selectedNavId: "hn-inbox",
	},
};

export const WithOutbox: Story = {
	args: { selectedNavId: "outbox" },
};

export const NoAccounts: Story = {
	args: { accounts: [], selectedNavId: "brief" },
};

export const Loading: Story = {
	args: {
		accounts: [
			{
				id: "acct-personal",
				label: "Personal",
				email: "matthijs@example.com",
				status: "loading",
				mailboxes: [],
			},
		],
		selectedNavId: "brief",
	},
};

export const LoadError: Story = {
	args: {
		accounts: [
			{
				id: "acct-personal",
				label: "Personal",
				email: "matthijs@example.com",
				status: "error",
				onRetry: () => undefined,
				mailboxes: [],
			},
		],
		selectedNavId: "brief",
	},
};

/** Each nav row is a real anchor: the linkComponent renders <a href>. */
export const AsLinks: Story = {
	args: {
		selectedNavId: "personal-inbox",
		linkComponent: ({ navId, className, ariaLabel, title, children }) => (
			<a
				href={`#/${navId}`}
				className={className}
				aria-label={ariaLabel}
				title={title}
			>
				{children}
			</a>
		),
	},
};
