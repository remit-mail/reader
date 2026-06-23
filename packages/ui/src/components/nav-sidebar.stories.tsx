import type { Meta, StoryObj } from "@storybook/react";
import type { NavAccount } from "./app-shell-types.js";
import { NavSidebar } from "./nav-sidebar.js";

const accounts: NavAccount[] = [
	{
		id: "acct-personal",
		label: "Personal",
		email: "matthijs@example.com",
		mailboxes: [
			{ id: "personal-inbox", name: "Inbox", unseen: 12 },
			{ id: "personal-sent", name: "Sent", specialUse: ["\\Sent"] },
			{ id: "personal-archive", name: "Archive", specialUse: ["\\Archive"] },
			{ id: "personal-trash", name: "Trash", specialUse: ["\\Trash"] },
			{ id: "personal-receipts", name: "Receipts", unseen: 3 },
			{ id: "personal-travel", name: "Travel" },
		],
	},
	{
		id: "acct-work",
		label: "Work",
		email: "matthijs@work.example",
		mailboxes: [
			{ id: "work-inbox", name: "Inbox", unseen: 4 },
			{ id: "work-sent", name: "Sent", specialUse: ["\\Sent"] },
			{ id: "work-trash", name: "Trash", specialUse: ["\\Trash"] },
		],
	},
];

const manyFoldersAccount: NavAccount = {
	id: "acct-archivist",
	label: "Archivist",
	email: "archivist@example.com",
	mailboxes: [
		{ id: "arch-inbox", name: "Inbox", unseen: 1 },
		{ id: "arch-sent", name: "Sent", specialUse: ["\\Sent"] },
		{ id: "arch-trash", name: "Trash", specialUse: ["\\Trash"] },
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

export const ManyFolders: Story = {
	args: {
		accounts: [manyFoldersAccount],
		selectedNavId: "arch-inbox",
	},
};
