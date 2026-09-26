import type {
	RemitImapAddressResponse,
	RemitImapVipSuggestionEntry,
} from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld, NOW } from "@/mocks/story-frame/mail-world";

const suggestion = (
	addressId: string,
	displayName: string,
	normalizedEmail: string,
	inboundCount: number,
	replyCount: number,
): RemitImapVipSuggestionEntry => ({
	addressId,
	displayName,
	normalizedEmail,
	inboundCount,
	outboundCount: replyCount,
	replyCount,
});

const flagged = (
	addressId: string,
	displayName: string,
	normalizedEmail: string,
	flags: RemitImapAddressResponse["flags"],
): RemitImapAddressResponse => {
	const [localPart = "", domain = ""] = normalizedEmail.split("@");
	return {
		addressId,
		accountConfigId: "cfg-1",
		displayName,
		localPart,
		domain,
		normalizedEmail,
		flags,
		inboundCount: 0,
		outboundCount: 0,
		replyCount: 0,
		lastInboundAt: NOW,
		lastReplyAt: 0,
		createdAt: NOW,
		updatedAt: NOW,
	};
};

const world = mailWorld({
	vipSuggestions: [
		suggestion("addr-ada", "Ada Lovelace", "ada@acme.example", 48, 21),
		suggestion("addr-grace", "Grace Hopper", "grace@example.org", 12, 4),
		suggestion("addr-linus", "Linus", "linus@example.org", 7, 0),
	],
	addresses: [
		flagged("addr-weekly", "The Weekly", "digest@weekly.example", {
			muted: { value: true, setAt: NOW, reason: "too frequent" },
		}),
		flagged("addr-outdoor", "Outdoor Store", "news@outdoor.example", {
			muted: { value: true, setAt: NOW },
		}),
		flagged("addr-spam", "Prize Desk", "win@prize.example", {
			blocked: { value: true, setAt: NOW },
		}),
	],
});

const meta = {
	title: "Playground/Shipped/Settings/Senders",
	component: AppStory,
	args: { url: "/settings/senders" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const SendersAndRules: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Ada Lovelace")).toBeVisible();
		await expect(
			canvas.getByText("48 received · you replied 21×"),
		).toBeVisible();
		await expect(
			canvas.getByText("7 received · you've never replied"),
		).toBeVisible();
		await expect(
			canvas.getAllByRole("button", { name: "Add VIP" }),
		).toHaveLength(3);
		await expect(canvas.getByText("3 of 3 flagged senders")).toBeVisible();
	},
};

export const FilteredVips: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Ada Lovelace");
		await userEvent.type(
			canvas.getByPlaceholderText("Filter vips by name or address"),
			"grace",
		);
		await expect(
			await canvas.findByText("1 of 3 flagged senders"),
		).toBeVisible();
		await expect(canvas.queryByText("Ada Lovelace")).toBeNull();
	},
};

export const MutedSearch: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Ada Lovelace");
		await userEvent.click(canvas.getByRole("tab", { name: /^Muted/ }));
		await expect(
			canvas.getByText(/Type 2\+ characters to search muted senders/),
		).toBeVisible();
		await userEvent.type(
			canvas.getByPlaceholderText("Filter muted by name or address"),
			"example",
		);
		await expect(await canvas.findByText("The Weekly")).toBeVisible();
		await expect(canvas.getByText("Outdoor Store")).toBeVisible();
		await expect(canvas.queryByText("Prize Desk")).toBeNull();
		await expect(
			canvas.getAllByRole("button", { name: "Remove muted flag" }),
		).toHaveLength(2);
	},
};

export const Empty: Story = {
	parameters: {
		msw: { handlers: mailHandlers(mailWorld()) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/No VIP suggestions yet/),
		).toBeVisible();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Ada Lovelace")).toBeVisible();
		await expect(canvas.getByRole("tab", { name: /^VIPs/ })).toBeVisible();
	},
};
