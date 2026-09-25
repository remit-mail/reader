import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
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

export const InTopBar: Story = {
	render: (args) => (
		<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
			<div className="flex-1" />
			<AccountMenu {...args} />
		</header>
	),
};
