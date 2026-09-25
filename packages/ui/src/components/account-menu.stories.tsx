import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AccountMenu } from "./account-menu.js";

const EMAIL = "info@example.com";

const meta: Meta<typeof AccountMenu> = {
	title: "Design System/Auth/AccountMenu",
	component: AccountMenu,
	parameters: { layout: "padded" },
	args: { email: EMAIL, onSignOut: () => undefined },
	render: (args) => (
		<div className="flex h-48 justify-end p-4">
			<AccountMenu {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof AccountMenu>;

export const Closed: Story = {};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Account" }));
		const page = within(canvasElement.ownerDocument.body);
		await expect(page.getByTestId("account-menu-email")).toHaveTextContent(
			EMAIL,
		);
		await expect(
			page.getByRole("menuitem", { name: "Sign out" }),
		).toBeVisible();
	},
};

export const NoEmail: Story = {
	args: { email: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Account" }));
		const page = within(canvasElement.ownerDocument.body);
		await expect(page.queryByTestId("account-menu-email")).toBeNull();
		await expect(
			page.getByRole("menuitem", { name: "Sign out" }),
		).toBeVisible();
	},
};

export const KeyboardReachesSignOut: Story = {
	args: { onSignOut: fn() },
	render: (args) => (
		<div className="flex h-48 items-start justify-end gap-2 p-4">
			<AccountMenu {...args} />
			<button type="button">After the menu</button>
		</div>
	),
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const trigger = canvas.getByRole("button", { name: "Account" });

		await userEvent.tab();
		await expect(trigger).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		const signOut = await page.findByRole("menuitem", { name: "Sign out" });
		await waitFor(() => expect(signOut).toHaveFocus());

		await userEvent.keyboard("{Escape}");
		await expect(page.queryByRole("menuitem")).toBeNull();
		await expect(trigger).toHaveFocus();

		await userEvent.keyboard("{Enter}");
		await waitFor(() =>
			expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveFocus(),
		);
		await userEvent.keyboard("{Enter}");
		await expect(args.onSignOut).toHaveBeenCalledOnce();
		await expect(trigger).toHaveFocus();
	},
};

export const InTopBar: Story = {
	render: (args) => (
		<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
			<div className="flex-1" />
			<AccountMenu {...args} />
		</header>
	),
};
