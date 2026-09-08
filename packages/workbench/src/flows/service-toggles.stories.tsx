import { AccountServiceOffNotice, type NavAccount } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { allThreads, navAccounts, workId } from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";
import {
	AccountListWithServiceOff,
	AccountPickerWithServiceOff,
	AccountServiceSettings,
	PausedProviderCalendar,
} from "./service-toggles.js";

/**
 * Switching a service off for one account, and every surface that then has to
 * say so (#1179). Invariant 1 says disabling deletes nothing; these are the
 * screens that make that believable.
 */
const meta: Meta = {
	title: "Flows/Service toggles",
	parameters: { layout: "fullscreen" },
	globals: { viewport: { value: "desktop" } },
};
export default meta;

type Story = StoryObj;

/**
 * S1 — the switches on account settings, mail and calendar side by side, both
 * on. This is the state an Outlook account arrives in from onboarding.
 */
export const Settings: Story = {
	render: () => <AccountServiceSettings />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("switch", { name: "Sync mail" }),
		).toBeChecked();
		await expect(
			canvas.getByRole("switch", { name: "Sync calendar" }),
		).toBeChecked();
	},
};

/**
 * S2 — mail off. The confirmation is where the promise is made, so it makes it
 * in full: the stored mail stays, the sync stops, nothing is deleted. Only
 * after Stop syncing mail does the screen move.
 */
export const DisableMail: Story = {
	render: () => <AccountServiceSettings />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("switch", { name: "Sync mail" }));

		const dialog = within(canvas.getByRole("dialog"));
		await expect(canvas.getByText(/Mail already in Remit stays/)).toBeVisible();
		await expect(canvas.getByText(/Nothing is deleted/)).toBeVisible();

		await userEvent.click(
			dialog.getByRole("button", { name: "Stop syncing mail" }),
		);
		await expect(
			canvas.getByRole("switch", { name: "Sync mail" }),
		).not.toBeChecked();
		await expect(canvas.getByText("mail sync off")).toBeVisible();
	},
};

/**
 * S3 — calendar on, for an account whose consent never covered it. Scopes come
 * from the authorization request, so the round trip is named before the person
 * commits and nothing changes until they are back.
 */
export const EnableUnconsentedService: Story = {
	render: () => (
		<AccountServiceSettings services={["Mail"]} consented={["Mail"]} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/signing in with Microsoft again/),
		).toBeVisible();

		await userEvent.click(
			canvas.getByRole("switch", { name: "Sync calendar" }),
		);
		const dialog = within(canvas.getByRole("dialog"));
		await expect(
			canvas.getByText(/Remit sends you to Microsoft to ask for it/),
		).toBeVisible();
		await userEvent.click(
			dialog.getByRole("button", { name: "Continue to Microsoft" }),
		);
		await expect(
			canvas.getByRole("switch", { name: "Sync calendar" }),
		).toBeChecked();
	},
};

/**
 * The switch that would leave the account syncing nothing. No stored account
 * holds the empty set, so this points at removing the account and says what
 * that costs.
 */
export const LastServiceOff: Story = {
	render: () => (
		<AccountServiceSettings services={["Mail"]} consented={["Mail"]} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("switch", { name: "Sync mail" }));
		await expect(
			canvas.getByText(/An account has to sync something/),
		).toBeVisible();
	},
};

/**
 * S7 — an IMAP account. It syncs mail and nothing else, so it is offered no
 * switches at all, and the screen says why rather than showing a dead control.
 */
export const ImapAccount: Story = {
	render: () => (
		<AccountServiceSettings
			connector="imap"
			label="Personal"
			email="alice.tan@gmail.example"
			services={["Mail"]}
			consented={["Mail"]}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("switch")).toBeNull();
		await expect(
			canvas.getByText(/carries mail and nothing else/),
		).toBeVisible();
	},
};

/** S4a — the account list. The mail-disabled account is present and labelled. */
export const AccountList: Story = {
	render: () => <AccountListWithServiceOff />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Work")).toBeVisible();
		await expect(canvas.getByText("mail sync off")).toBeVisible();
	},
};

/** S4b — the account picker. Every account is pickable; the stopped one says so. */
export const AccountPicker: Story = {
	parameters: { layout: "centered" },
	render: () => <AccountPickerWithServiceOff />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Work")).toBeVisible();
		await expect(canvas.getByText("mail sync off")).toBeVisible();
	},
};

/** The nav accounts with Work's mail sync switched off. */
const accountsWithMailOff: NavAccount[] = navAccounts.map((account) =>
	account.id === workId
		? { ...account, syncedServices: ["Calendar" as const] }
		: account,
);

const workThreads = allThreads.filter((thread) => thread.accountId === workId);

/**
 * S4c — the sidebar. The account keeps its heading and every mailbox it already
 * synced, with the label beside its name.
 */
export const Sidebar: Story = {
	render: () => (
		<MailShell
			accounts={accountsWithMailOff}
			selectedNavId="brief"
			listTitle="Daily brief"
			sections={[{ id: "brief", threads: workThreads }]}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("mail sync off")).toBeVisible();
		await expect(canvas.getAllByText("Inbox").length).toBeGreaterThan(0);
	},
};

/**
 * S5 — a mail-disabled account's stored mailbox, opened directly. The mail is
 * all there and reads normally; the notice above it says what stopped, so an
 * unchanging inbox is never mistaken for a broken one.
 */
export const StoredMailbox: Story = {
	render: () => (
		<MailShell
			accounts={accountsWithMailOff}
			selectedNavId="mbx_work_inbox"
			listTitle="Inbox"
			unreadCount={workThreads.filter((thread) => !thread.isRead).length}
			sections={[{ id: "inbox", threads: workThreads }]}
			listNotice={
				<AccountServiceOffNotice service="Mail" onEnable={() => undefined} />
			}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("status")).toHaveTextContent(
			"Everything already synced is here to read",
		);
		await expect(
			canvas.getByRole("button", { name: "Turn mail back on" }),
		).toBeVisible();
	},
};

/**
 * S6 — a paused provider calendar. Sync stopped at the last completed round and
 * every event it read is still on the grid, still coloured, still tickable.
 */
export const PausedCalendar: Story = {
	render: () => <PausedProviderCalendar />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("status")).toHaveTextContent(
			"Its events stay on your calendar",
		);
		await expect(canvas.getByLabelText("calendar sync off")).toBeVisible();
	},
};
