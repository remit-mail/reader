import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld, NOW } from "@/mocks/story-frame/mail-world";
import { signedInAs } from "@/mocks/story-frame/session";
import { makeAccount } from "@/test-support/fixtures";

const accounts = [
	makeAccount({
		accountId: "acc-personal",
		email: "alice.tan@gmail.example",
		displayName: "Personal",
		lastSyncAt: NOW,
	}),
	makeAccount({
		accountId: "acc-work",
		email: "alice@northwind.example",
		displayName: "Work",
		lastSyncAt: NOW,
		lastError:
			"AUTHENTICATIONFAILED: [ALERT] Application-specific password required",
	}),
	makeAccount({
		accountId: "acc-forum",
		email: "alice@synthcollective.example",
		displayName: "Synthwave Forum",
		lastSyncAt: NOW,
		muted: { value: true, setAt: NOW },
	}),
];

const world = mailWorld({ accounts });

const meta = {
	title: "Playground/Shipped/Settings/Accounts",
	component: AppStory,
	args: { url: "/settings/accounts" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const desktop = { viewport: { value: "desktop", isRotated: false } };
const tablet = { viewport: { value: "tablet", isRotated: false } };
const phone = { viewport: { value: "mobile", isRotated: false } };

const page = within(document.body);

const openEditPanel = async (canvasElement: HTMLElement, index: number) => {
	const canvas = within(canvasElement);
	await canvas.findAllByRole("button", { name: "Manage" });
	const manage = canvas.getAllByRole("button", { name: "Manage" })[index];
	if (manage) await userEvent.click(manage);
	return page.findByRole("dialog", { name: "Edit Account" });
};

export const Accounts: Story = {
	globals: desktop,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Personal")).toBeVisible();
		await expect(canvas.getByText("3 accounts")).toBeVisible();
		await expect(
			canvas.getByText(/Application-specific password required/),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Reconnect" }),
		).toBeVisible();
		await expect(
			canvas.getAllByRole("button", { name: "Manage" }),
		).toHaveLength(2);
	},
};

export const AccountsScrolling: Story = {
	name: "Accounts — desktop, beyond the fold",
	globals: desktop,
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					accounts: Array.from({ length: 9 }, (_, index) =>
						makeAccount({
							accountId: `acc-${index + 1}`,
							email: `alice+${index + 1}@northwind.example`,
							displayName: `Account ${index + 1}`,
							lastSyncAt: NOW,
						}),
					),
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Account 9");
		const leave = canvas.getByRole("button", {
			name: "Delete your Remit account",
		});
		leave.scrollIntoView();
		await expect(leave).toBeVisible();
		await expect(
			canvas.getByRole("heading", { name: "Accounts" }),
		).toBeVisible();
	},
};

export const AccountsMissingSyncDate: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					accounts: [
						makeAccount({
							accountId: "acc-personal",
							email: "alice.tan@gmail.example",
							displayName: "Personal",
						}),
					],
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText(/never synced/)).toBeVisible();
	},
};

export const ShellPhone: Story = {
	name: "Shell — phone",
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Personal");
		await expect(
			canvas.getByRole("button", { name: "Open settings menu" }),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Back to mail" }),
		).toBeVisible();
	},
};

export const ShellTablet: Story = {
	name: "Shell — tablet",
	globals: tablet,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Personal");
		await expect(
			canvas.getByRole("button", { name: "Open settings menu" }),
		).toBeVisible();
	},
};

export const AccountsEmpty: Story = {
	name: "Accounts — empty",
	parameters: {
		msw: { handlers: mailHandlers(mailWorld({ accounts: [] })) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("No accounts configured."),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Add your first account" }),
		).toBeVisible();
	},
};

export const AccountsLoading: Story = {
	name: "Accounts — loading",
	parameters: {
		msw: {
			handlers: [
				http.get("/api/config", () => new Promise<never>(() => undefined)),
				...mailHandlers(world),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("status", { name: "Loading accounts" }),
		).toBeVisible();
	},
};

export const AccountsOauthSuccess: Story = {
	name: "Accounts — OAuth success",
	args: { url: "/settings/accounts?connected=acc-personal" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText(/^Connected /)).toBeVisible();
		await expect(canvas.getByText(/Access granted/)).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: /Go to inbox|Continue/ }),
		);
		await expect(
			await canvas.findByText("Account connected successfully."),
		).toBeVisible();
	},
};

export const AccountsOauthError: Story = {
	name: "Accounts — OAuth error",
	args: { url: "/settings/accounts?oauthError=consent_required" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/admin needs to approve Remit/),
		).toBeVisible();
	},
};

export const AccountsDeleteConfirm: Story = {
	name: "Accounts — delete confirm",
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Work");
		const remove = canvas.getAllByRole("button", { name: "Delete account" })[1];
		if (remove) await userEvent.click(remove);
		const dialog = within(
			await page.findByRole("dialog", { name: "Delete account" }),
		);
		await expect(dialog.getByText("Are you sure?")).toBeVisible();
		await expect(dialog.getByText("alice@northwind.example")).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Delete account" }),
		).toBeEnabled();
	},
};

export const AccountEdit: Story = {
	name: "Accounts — edit",
	globals: desktop,
	play: async ({ canvasElement }) => {
		const panel = within(await openEditPanel(canvasElement, 0));
		await expect(panel.getByLabelText("Display name (optional)")).toHaveValue(
			"Personal",
		);
		await expect(panel.getByLabelText("Email Address")).toHaveValue(
			"alice.tan@gmail.example",
		);
	},
};

export const AccountEditClosed: Story = {
	name: "Accounts — edit panel closed",
	globals: desktop,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Personal")).toBeVisible();
		await expect(
			page.queryByRole("dialog", { name: "Edit Account" }),
		).toBeNull();
		await expect(
			canvas.getByRole("button", { name: "Add account" }),
		).toBeVisible();
	},
};

export const AccountEditPhone: Story = {
	name: "Accounts — edit, phone",
	globals: phone,
	play: async ({ canvasElement }) => {
		const panel = await openEditPanel(canvasElement, 0);
		await expect(panel).toBeVisible();
		await expect(
			within(panel).getByLabelText("Display name (optional)"),
		).toBeVisible();
	},
};

export const AccountEditNoDisplayName: Story = {
	name: "Accounts — edit, no display name",
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					accounts: [
						makeAccount({
							accountId: "acc-personal",
							email: "alice.tan@gmail.example",
							lastSyncAt: NOW,
						}),
					],
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Alice Tan")).toBeVisible();
		const panel = within(await openEditPanel(canvasElement, 0));
		const field = panel.getByLabelText("Display name (optional)");
		await expect(field).toHaveValue("");
		await expect(field).toHaveAttribute("placeholder", "Alice");
	},
};

export const DangerZone: Story = {
	name: "Danger zone",
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Personal");
		await expect(
			canvas.getByText(/erases Remit's copy of your mail/),
		).toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "Delete your Remit account" }),
		).toBeInTheDocument();
	},
};

export const DangerZoneConfirm: Story = {
	name: "Danger zone — confirm dialog",
	args: { authProvider: signedInAs("alice.tan@gmail.example") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Personal");
		await userEvent.click(
			canvas.getByRole("button", { name: "Delete your Remit account" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Delete your Remit account" }),
		);
		await expect(dialog.getByText("alice.tan@gmail.example")).toBeVisible();
		await userEvent.type(
			dialog.getByLabelText(/to confirm/),
			"someone@else.example",
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Delete everything" }),
		);
		await waitFor(() =>
			expect(dialog.getByRole("alert")).toHaveTextContent(
				"That doesn't match your account email",
			),
		);
	},
};

export const AccountsUnreadable: Story = {
	name: "Accounts — unreadable",
	parameters: {
		msw: {
			handlers: [
				http.get("/api/config", () => HttpResponse.error()),
				...mailHandlers(world),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Couldn't load accounts"),
		).toBeVisible();
	},
};
