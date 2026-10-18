import type {
	RemitImapQuarantineResponse,
	RemitImapSyncWarningResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import {
	MINUTE,
	mailboxIdFor,
	mailWorld,
	NOW,
	PERSONAL,
} from "@/mocks/story-frame/mail-world";

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

const failing = (
	uid: number,
	role: "Inbox" | "Archive",
	stage: RemitImapSyncWarningResponse["stage"],
	attempts: number,
): RemitImapSyncWarningResponse => ({
	syncWarningId: `w-${uid}`,
	accountConfigId: "cfg-1",
	accountId: PERSONAL,
	mailboxId: mailboxIdFor(PERSONAL, role),
	uidValidity: 1_712_000_000,
	uid,
	stage,
	attempts,
	createdAt: NOW - uid * MINUTE,
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

const bodyGaveUp = failing(3, "Inbox", "Body", 3);
const headerRetrying = failing(5, "Archive", "Header", 6);

const meta = {
	title: "Playground/Shipped/Settings/Warnings",
	component: AppStory,
	args: { url: "/settings/warnings" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/Every message is syncing/),
		).toBeVisible();
		await expect(
			canvas.getByText(/Every message has been read successfully/),
		).toBeVisible();
	},
};

export const Mixed: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					syncWarnings: [bodyGaveUp, headerRetrying],
					syncWarningsTotal: 2,
					quarantine: [unreadableBody],
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Gave up")).toBeVisible();
		await expect(canvas.getByText("Retrying")).toBeVisible();
		await expect(
			canvas.getByText(/multipart boundary was never closed/),
		).toBeVisible();
	},
};

export const OverCap: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					syncWarnings: [bodyGaveUp, headerRetrying],
					syncWarningsTotal: 4_812,
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/Showing the 2 newest of 4812/),
		).toBeVisible();
	},
};

export const QuarantineAlert: Story = {
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

export const Loading: Story = {
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
			await canvas.findByText("Checking for warnings…"),
		).toBeVisible();
	},
};

export const ReadFailure: Story = {
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
			await canvas.findByText("The warnings could not be read."),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Report this" }),
		).toBeVisible();
	},
};

export const SignedOut: Story = {
	parameters: {
		msw: {
			handlers: [
				http.get("/api/me/quarantine", () =>
					HttpResponse.json(
						{ status: 401, message: "Unauthorized" },
						{ status: 401 },
					),
				),
				...mailHandlers(mailWorld()),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Your session has ended."),
		).toBeVisible();
		await expect(canvas.queryByText(/Every message is syncing/)).toBeNull();
	},
};
