import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	REDIRECT_STALL_MESSAGE,
	REDIRECT_STALL_MS,
} from "@/hooks/useRedirectEnded";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";
import {
	NEW_ACCOUNT_ID,
	type OnboardingHandlerOptions,
	onboardingHandlers,
} from "@/mocks/story-frame/onboarding-handlers";
import { makeAccount } from "@/test-support/fixtures";

const EMAIL = "alice@northwind.example";

const firstRun = mailWorld({ accounts: [], threads: [], outbox: [] });

const handlers = (
	options: OnboardingHandlerOptions = {},
	world = firstRun,
) => ({
	msw: { handlers: [...onboardingHandlers(options), ...mailHandlers(world)] },
});

const meta = {
	title: "Playground/Shipped/Onboarding/Wizard",
	component: AppStory,
	args: { url: "/onboarding" },
	parameters: { layout: "fullscreen", ...handlers() },
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

const phone = { viewport: { value: "mobile", isRotated: false } };

const press = async (canvas: Canvas, name: string | RegExp) =>
	userEvent.click(await canvas.findByRole("button", { name }));

const toConnector = (canvas: Canvas) => press(canvas, "Add your first account");

const toAddress = async (canvas: Canvas) => {
	await toConnector(canvas);
	await press(canvas, "Continue with IMAP");
};

const toServers = async (canvas: Canvas, email = EMAIL) => {
	await toAddress(canvas);
	await userEvent.type(await canvas.findByLabelText("Email address"), email);
	await press(canvas, "Continue");
	await canvas.findByText("Confirm server settings");
};

const toCredentials = async (canvas: Canvas) => {
	await toServers(canvas);
	await press(canvas, "Continue");
	await canvas.findByText("Sign in to northwind.example");
};

const toTest = async (canvas: Canvas) => {
	await toCredentials(canvas);
	await userEvent.type(canvas.getByLabelText(/Password/), "app-password");
	await press(canvas, "Test connection");
};

const toMicrosoft = async (canvas: Canvas) => {
	await toConnector(canvas);
	await userEvent.click(await canvas.findByText("Outlook / Microsoft 365"));
	await press(canvas, "Continue with Microsoft");
	return canvas.findByRole("button", { name: "Sign in with Microsoft" });
};

export const Welcome: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Welcome to Remit")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Import a config file" }),
		).toBeVisible();
	},
};

export const Walkthrough: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByText(`Syncing ${EMAIL}`, undefined, {
				timeout: 4000,
			}),
		).toBeVisible();
		await expect(
			await canvas.findByRole("button", { name: "Go to inbox" }),
		).toBeEnabled();
	},
};

export const ConnectorPicker: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toConnector(canvas);
		await expect(
			await canvas.findByText("How does this account connect?"),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Continue with IMAP" }),
		).toBeVisible();
		await expect(canvas.queryByText(/Google/)).toBeNull();
	},
};

export const ConnectorPickerMicrosoft: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toConnector(canvas);
		await userEvent.click(await canvas.findByText("Outlook / Microsoft 365"));
		await expect(
			canvas.getByRole("button", { name: "Continue with Microsoft" }),
		).toBeVisible();
	},
};

export const ConnectorPickerInSettings: Story = {
	args: { url: "/settings/accounts" },
	parameters: handlers({}, mailWorld()),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await press(canvas, "Add account");
		await expect(
			await canvas.findByText("How does this account connect?"),
		).toBeVisible();
		await expect(canvas.queryByRole("button", { name: "Back" })).toBeNull();
	},
};

export const ConnectorPickerPhone: Story = {
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toConnector(canvas);
		await expect(
			await canvas.findByRole("button", { name: "Continue with IMAP" }),
		).toBeVisible();
	},
};

export const ConnectorPickerMicrosoftPhone: Story = {
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toConnector(canvas);
		await userEvent.click(await canvas.findByText("Outlook / Microsoft 365"));
		await expect(
			canvas.getByRole("button", { name: "Continue with Microsoft" }),
		).toBeVisible();
	},
};

export const MicrosoftEmail: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await toMicrosoft(canvas)).toBeEnabled();
		await expect(
			canvas.getByLabelText("Email address (optional)"),
		).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
	},
};

export const MicrosoftEmailInSettings: Story = {
	args: { url: "/settings/accounts" },
	parameters: handlers({}, mailWorld()),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await press(canvas, "Add account");
		await userEvent.click(await canvas.findByText("Outlook / Microsoft 365"));
		await press(canvas, "Continue with Microsoft");
		await expect(
			await canvas.findByRole("button", { name: "Sign in with Microsoft" }),
		).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
	},
};

const realSetTimeout = window.setTimeout;

const stallAtOnce: Window["setTimeout"] = (handler, delay, ...rest) =>
	realSetTimeout(handler, delay === REDIRECT_STALL_MS ? 0 : delay, ...rest);

export const MicrosoftRedirectStalled: Story = {
	beforeEach: () => () => {
		Reflect.set(window, "setTimeout", realSetTimeout);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const signIn = await toMicrosoft(canvas);
		Reflect.set(window, "setTimeout", stallAtOnce);
		await userEvent.click(signIn);
		await expect(await canvas.findByText(REDIRECT_STALL_MESSAGE)).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();
	},
};

export const AddressAutodiscovery: Story = {
	parameters: handlers({ autoconfig: "slow" }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toAddress(canvas);
		await userEvent.type(await canvas.findByLabelText("Email address"), EMAIL);
		await press(canvas, "Continue");
		await expect(
			await canvas.findByText("Looking up settings for northwind.example…"),
		).toBeVisible();
	},
};

export const AddressInvalid: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toAddress(canvas);
		await userEvent.type(
			await canvas.findByLabelText("Email address"),
			"alice",
		);
		await press(canvas, "Continue");
		await expect(
			await canvas.findByText("Enter a valid email address."),
		).toBeVisible();
	},
};

export const ServerConfirm: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toServers(canvas);
		await expect(canvas.getByText(/Found via autodiscovery/)).toBeVisible();
		await expect(canvas.getAllByText("detected")).toHaveLength(2);
		await expect(
			canvas.getAllByDisplayValue("mail.northwind.example"),
		).toHaveLength(2);
	},
};

export const ServerConfirmPhone: Story = {
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toServers(canvas);
		for (const security of canvas.getAllByLabelText("Security")) {
			await expect(security).toBeEnabled();
		}
	},
};

export const ServerManualFallback: Story = {
	parameters: handlers({ autoconfig: "missing" }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toServers(canvas);
		await expect(
			canvas.getByText(/couldn't detect settings for northwind.example/),
		).toBeVisible();
		await expect(
			canvas.getByDisplayValue("imap.northwind.example"),
		).toBeVisible();
		await expect(canvas.queryByText("detected")).toBeNull();
	},
};

export const ServerMissingHost: Story = {
	parameters: handlers({ autoconfig: "missing" }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toServers(canvas);
		await userEvent.clear(canvas.getByDisplayValue("imap.northwind.example"));
		await press(canvas, "Continue");
		await expect(await canvas.findByText("Enter the IMAP host.")).toBeVisible();
	},
};

export const ServerProviderPreset: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toServers(canvas, "alice@icloud.com");
		await expect(canvas.getByLabelText("Provider")).toHaveValue("icloud");
		await expect(
			canvas.getByText(/pre-filled for iCloud and locked/),
		).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: "Get an app password" }),
		).toBeVisible();
	},
};

export const Credentials: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toCredentials(canvas);
		await expect(canvas.getByLabelText("Username")).toHaveValue(EMAIL);
		await press(canvas, "Test connection");
		await expect(
			await canvas.findByText("Enter your username and password."),
		).toBeVisible();
	},
};

export const TestConnectionSuccess: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(await canvas.findByText("Connection verified")).toBeVisible();
	},
};

export const TestConnectionFailure: Story = {
	parameters: handlers({
		connection: {
			imapSuccess: true,
			smtpSuccess: false,
			smtpError: "535 5.7.8 Authentication credentials invalid",
		},
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByText(/many providers require an app password/),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Back to credentials" }),
		).toBeVisible();
	},
};

export const TestConnectionNetworkFailure: Story = {
	parameters: handlers({
		connection: {
			imapSuccess: false,
			imapError: "connect ECONNREFUSED 203.0.113.7:993",
		},
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByRole("button", { name: "Back to servers" }),
		).toBeVisible();
		await expect(canvas.getAllByText(/ECONNREFUSED/).length).toBeGreaterThan(0);
		await expect(
			canvas.queryByText(/many providers require an app password/),
		).toBeNull();
	},
};

export const SyncProgress: Story = {
	parameters: handlers({
		sync: {
			syncPhase: "syncing_inbox",
			mailboxCountTotal: 6,
			mailboxCountSynced: 0,
			mailboxes: [
				{
					mailboxId: "mbx-new-inbox",
					fullPath: "INBOX",
					phase: "syncing",
					messagesTotal: 800,
					messagesSynced: 120,
					highWaterMarkUid: 0,
				},
			],
		},
	}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByText("120 / 800 messages", undefined, {
				timeout: 4000,
			}),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Go to inbox" }),
		).toBeEnabled();
	},
};

const waitingForMail = handlers({
	sync: { syncPhase: "discovering_mailboxes", mailboxes: [] },
});

export const SyncWaitingForFirstMail: Story = {
	parameters: waitingForMail,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByRole(
				"button",
				{ name: "Getting your mail…" },
				{ timeout: 4000 },
			),
		).toBeDisabled();
	},
};

export const SyncWaitingForFirstMailPhone: Story = {
	globals: phone,
	parameters: waitingForMail,
	play: SyncWaitingForFirstMail.play,
};

export const SyncCreateError: Story = {
	parameters: handlers({ createFails: true }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByText("Couldn't create account", undefined, {
				timeout: 4000,
			}),
		).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible();
	},
};

export const SyncStalled: Story = {
	parameters: handlers(
		{ sync: { syncPhase: "error", mailboxes: [] } },
		mailWorld({
			accounts: [
				makeAccount({
					accountId: NEW_ACCOUNT_ID,
					email: EMAIL,
					lastError: "IMAP IDLE dropped: connection reset by peer",
				}),
			],
			threads: [],
			outbox: [],
		}),
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toTest(canvas);
		await expect(
			await canvas.findByText(/Sync stalled/, undefined, { timeout: 4000 }),
		).toBeVisible();
		await waitFor(() =>
			expect(
				canvas.getByText("IMAP IDLE dropped: connection reset by peer"),
			).toBeVisible(),
		);
	},
};

const OUTLOOK = makeAccount({
	accountId: "acc-outlook",
	email: "alice@outlook.com",
	authType: "oauthMicrosoft",
	syncedServices: ["Calendar"],
	grantedScopes: ["https://graph.microsoft.com/Calendars.Read"],
});

const withOutlook = mailWorld({
	accounts: [...mailWorld().accounts, OUTLOOK],
});

export const MicrosoftServiceChoice: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await toMicrosoft(canvas);
		await expect(canvas.getByRole("checkbox", { name: /^Mail/ })).toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: /^Calendar/ }),
		).toBeChecked();
	},
};

export const MicrosoftNothingPicked: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const signIn = await toMicrosoft(canvas);
		await userEvent.click(canvas.getByRole("checkbox", { name: /^Mail/ }));
		await userEvent.click(canvas.getByRole("checkbox", { name: /^Calendar/ }));
		await userEvent.click(signIn);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(signIn).toBeEnabled();
	},
};

export const MicrosoftGranted: Story = {
	args: { url: `/settings/accounts?connected=${OUTLOOK.accountId}` },
	parameters: handlers({}, withOutlook),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(`Connected ${OUTLOOK.email}`),
		).toBeVisible();
		await expect(canvas.getByText("Access granted — syncing")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Continue" }),
		).toBeEnabled();
	},
};

export const MicrosoftScopeNotGranted: Story = {
	args: {
		url: "/settings/accounts?oauthError=scope_not_granted&oauthEmail=bob%40outlook.com&missingServices=Calendar",
	},
	parameters: handlers({}, mailWorld()),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/did not grant access to Calendar/),
		).toBeVisible();
		await expect(canvas.getByLabelText("Email address (optional)")).toHaveValue(
			"bob@outlook.com",
		);
		await expect(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();
	},
};

export const MicrosoftReconnectScopeNotGranted: Story = {
	args: {
		url: `/settings/accounts?oauthError=scope_not_granted&oauthEmail=${encodeURIComponent(OUTLOOK.email)}&missingServices=Calendar`,
	},
	parameters: handlers({}, withOutlook),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(`Reconnect ${OUTLOOK.email}`),
		).toBeVisible();
		await expect(
			canvas.getByText(/did not grant access to Calendar/),
		).toBeVisible();
		await expect(canvas.getByLabelText("Email address (optional)")).toHaveValue(
			OUTLOOK.email,
		);
	},
};
