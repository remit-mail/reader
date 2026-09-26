import type { RemitImapQuarantineResponse } from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import {
	mailboxIdFor,
	mailWorld,
	NOW,
	PERSONAL,
} from "@/mocks/story-frame/mail-world";
import { withRuntimeConfig } from "@/mocks/story-frame/session";

const setAside = (
	id: string,
	role: "Inbox" | "Archive",
	failureCode: RemitImapQuarantineResponse["failureCode"],
	failureMessage: string,
): RemitImapQuarantineResponse => ({
	quarantineId: `q-${id}`,
	accountConfigId: "cfg-1",
	accountId: PERSONAL,
	mailboxId: mailboxIdFor(PERSONAL, role),
	uidValidity: 1_712_000_000,
	uid: 40_217,
	mailboxRole: role,
	mailboxPath: role === "Inbox" ? "INBOX" : "Archive",
	quarantinedAt: NOW,
	attempts: 3,
	failureStage: "BodyParse",
	failureCode,
	failureMessage,
	workerVersion: "worker 1.0.0",
	contentType: "multipart/mixed",
	sizeBytes: 184_233,
	structure: [{ depth: 0, contentType: "multipart/mixed" }],
	createdAt: NOW,
	updatedAt: NOW,
});

const unreadableBody = setAside(
	"1",
	"Inbox",
	"UnreadableBody",
	"multipart boundary was never closed",
);
const unknownCharset = setAside(
	"2",
	"Archive",
	"UnknownCharset",
	"declared charset is not a known encoding",
);

const meta = {
	title: "Playground/Shipped/Settings/Advanced/Overview",
	component: AppStory,
	args: { url: "/settings/advanced" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Advanced: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/Every message has been read successfully/),
		).toBeVisible();
		await expect(canvas.getByText("About")).toBeVisible();
		await expect(
			canvas.queryByRole("link", { name: "Download root certificate" }),
		).toBeNull();
	},
};

export const AdvancedOneQuarantined: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(mailWorld({ quarantine: [unreadableBody] })),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/multipart boundary was never closed/),
		).toBeVisible();
		await expect(canvas.queryByText(/messages could not be read/)).toBeNull();
	},
};

export const AdvancedQuarantineAlert: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({ quarantine: [unreadableBody, unknownCharset] }),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("2 messages could not be read."),
		).toBeVisible();
	},
};

export const AdvancedQuarantineLoading: Story = {
	parameters: {
		msw: {
			handlers: [
				http.get(
					"/api/me/quarantine",
					() => new Promise<never>(() => undefined),
				),
				...mailHandlers(mailWorld()),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Checking for messages set aside…"),
		).toBeVisible();
	},
};

export const AdvancedQuarantineUnreadable: Story = {
	parameters: {
		msw: {
			handlers: [
				http.get("/api/me/quarantine", () => HttpResponse.error()),
				...mailHandlers(mailWorld()),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(
				"The list of set-aside messages could not be read.",
			),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Report this" }),
		).toBeVisible();
	},
};

export const AdvancedTlsInternal: Story = {
	beforeEach: withRuntimeConfig({ tlsMode: "internal" }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("link", { name: "Download root certificate" }),
		).toHaveAttribute("href", "/tls-root-ca.crt");
	},
};
