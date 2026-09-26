import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import {
	mailboxIdFor,
	mailWorld,
	senderAddress,
	WORK,
} from "@/mocks/story-frame/mail-world";

const openMessage = `/mail/${mailboxIdFor(WORK, "Inbox")}/thread-q3-planning/msg-q3-planning`;

const world = mailWorld();

const meta = {
	title: "Playground/Shipped/Mail/Mail pickers",
	component: AppStory,
	args: { url: openMessage },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

export const MovePicker: Story = {
	play: async () => {
		await page().findByRole("heading", { level: 1, name: "Q3 planning" });
		await userEvent.click(
			await page().findByRole("button", { name: "Move to mailbox" }),
		);
		const filter = await page().findByLabelText("Filter folders");
		await expect(filter).toBeVisible();
		for (const folder of ["Archive", "Trash"]) {
			await expect(
				await page().findByRole("treeitem", { name: new RegExp(folder) }),
			).toBeVisible();
		}
	},
};

export const ReclassifyDialog: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers({
				...world,
				addresses: world.threads
					.filter((row) => row.messageId === "msg-q3-planning")
					.map(senderAddress),
			}),
		},
	},
	args: { url: `${openMessage}#intelligence` },
	globals: { viewport: { value: "desktop", isRotated: false } },
	play: async () => {
		const reclassify = await page().findByRole("button", {
			name: "reclassify",
		});
		await waitFor(() => expect(reclassify).toBeEnabled());
		await userEvent.click(reclassify);
		const dialog = await page().findByRole("dialog", {
			name: "Reclassify sender",
		});
		await expect(
			within(dialog).getByText("Reclassify this sender"),
		).toBeVisible();
		await expect(
			within(dialog).getByRole("button", { name: /Newsletter/ }),
		).toBeVisible();
		await expect(
			within(dialog).getByRole("button", { name: "Cancel" }),
		).toBeVisible();
	},
};
