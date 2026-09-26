import type {
	RemitImapSystemUpdateCheck,
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";

const CURRENT = "0.9.3";
const NEXT = "1.0.0";
const LOGS = "remit logs updater --since 2026-09-24T12:40";

const checked: RemitImapSystemUpdateCheck = {
	status: "ok",
	lastCheckedAt: "2026-09-24T12:39:00Z",
	latestVersion: CURRENT,
	updateAvailable: false,
};

const released: RemitImapSystemUpdateCheck = {
	status: "ok",
	lastCheckedAt: "2026-09-24T12:39:00Z",
	latestVersion: NEXT,
	publishedAt: "2026-09-22T09:00:00Z",
	summary: "Faster search and a calmer daily brief.",
	releaseNotesUrl: `https://github.com/remit-mail/reader/releases/tag/${NEXT}`,
	updateAvailable: true,
	schemaVersion: 42,
};

const run = (
	outcome: RemitImapSystemUpdateRun["outcome"],
	message: string,
	startedAt = "2026-09-24T12:40:00Z",
): RemitImapSystemUpdateRun => ({
	runId: "run-1",
	fromVersion: CURRENT,
	targetVersion: NEXT,
	phase: outcome === null ? "verifying" : "committing",
	outcome,
	startedAt,
	updatedAt: startedAt,
	message,
	logCommand: LOGS,
});

const update = (
	overrides: Partial<RemitImapSystemUpdateResponse>,
): RemitImapSystemUpdateResponse => ({
	currentVersion: CURRENT,
	currentSchemaVersion: 42,
	check: checked,
	run: null,
	...overrides,
});

const answering = (systemUpdate: RemitImapSystemUpdateResponse) => ({
	msw: { handlers: mailHandlers(mailWorld({ systemUpdate })) },
});

const meta = {
	title: "Playground/Shipped/Settings/Advanced/Self-update",
	component: AppStory,
	args: { url: "/settings/advanced" },
	parameters: { layout: "fullscreen", ...answering(update({})) },
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = within(document.body);

export const AdvancedUpToDate: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(`Remit ${CURRENT} is the latest version.`),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Check again" }),
		).toBeVisible();
	},
};

export const AdvancedNeverChecked: Story = {
	parameters: answering(update({ check: { status: "disabled" } })),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/No update check has run yet/),
		).toBeVisible();
	},
};

export const AdvancedUpdateAvailable: Story = {
	parameters: answering(update({ check: released })),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: `Install ${NEXT}` }),
		).toBeVisible();
		await expect(canvas.getByText("update available")).toBeVisible();
	},
};

export const AdvancedCheckFailed: Story = {
	parameters: answering(
		update({
			check: {
				status: "failed",
				lastCheckedAt: "2026-09-21T12:00:00Z",
				error: "No route to github.com — the server has no outbound network.",
			},
		}),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Could not reach the update source."),
		).toBeVisible();
		await expect(canvas.getByText(/No route to github.com/)).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Try again" }),
		).toBeVisible();
	},
};

export const AdvancedSucceeded: Story = {
	parameters: answering(
		update({ currentVersion: NEXT, run: run("succeeded", "Updated") }),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(`Updated to Remit ${NEXT}.`),
		).toBeVisible();
		await expect(canvas.getByText(`Remit ${NEXT} is running.`)).toBeVisible();
	},
};

export const AdvancedRolledBack: Story = {
	parameters: answering(
		update({
			run: run(
				"rolledBack",
				'migration 0042_add_thread_index failed: relation "threads" does not exist',
			),
		}),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/relation "threads" does not exist/),
		).toBeVisible();
		await expect(canvas.getByText(LOGS)).toBeVisible();
	},
};

export const AdvancedRollbackFailed: Story = {
	parameters: answering(
		update({
			run: run(
				"rollbackFailed",
				"migration 0042_add_thread_index failed and the snapshot restore errored: database is locked",
			),
		}),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/the snapshot restore errored/),
		).toBeVisible();
		await expect(canvas.getByText(LOGS)).toBeVisible();
	},
};

export const AdvancedAbandoned: Story = {
	parameters: answering(
		update({
			run: run(
				"abandoned",
				"manifest fetch timed out before anything was pulled",
			),
		}),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/manifest fetch timed out/),
		).toBeVisible();
	},
};

export const ConsentWithSchemaMigration: Story = {
	parameters: answering(update({ currentSchemaVersion: 41, check: released })),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: `Install ${NEXT}` }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: `Install Remit ${NEXT}` }),
		);
		await expect(
			dialog.getByText(/updates the database while Remit is offline/),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Install and restart" }),
		).toBeVisible();
	},
};

export const RestartInProgress: Story = {
	parameters: answering(
		update({
			run: run(null, "", new Date(Date.now() - 52_000).toISOString()),
		}),
	),
	play: async () => {
		await expect(
			await page.findByRole("heading", { name: `Installing Remit ${NEXT}` }),
		).toBeVisible();
	},
};

let answered = false;

const realNow = Date.now;

const clockAhead = (ms: number) => {
	Date.now = () => realNow.call(Date) + ms;
};

export const ServerNeverCameBack: Story = {
	parameters: {
		msw: {
			handlers: [
				http.get("/api/system/update", () => {
					if (answered) return HttpResponse.error();
					answered = true;
					return HttpResponse.json<RemitImapSystemUpdateResponse>(
						update({ run: run(null, "", new Date().toISOString()) }),
					);
				}),
				...mailHandlers(mailWorld()),
			],
		},
	},
	beforeEach: () => {
		answered = false;
		return () => {
			Date.now = realNow;
		};
	},
	play: async () => {
		await page.findByRole("heading", { name: `Installing Remit ${NEXT}` });
		clockAhead(20 * 60_000);
		await waitFor(
			() =>
				expect(page.getByRole("alertdialog")).toHaveTextContent(
					"Your mail is safe at your provider",
				),
			{ timeout: 10_000 },
		);
	},
};
