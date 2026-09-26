import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, within } from "storybook/test";
import { mapOauthError } from "@/routes/settings/accounts";
import { AccountGranted, StepMicrosoftEmail } from "./OnboardingWizard";

const meta: Meta<typeof StepMicrosoftEmail> = {
	title: "Playground/Shipped/Onboarding/Microsoft",
	component: StepMicrosoftEmail,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<QueryClientProvider
				client={
					new QueryClient({
						defaultOptions: {
							queries: { retry: false },
							mutations: { retry: false },
						},
					})
				}
			>
				<Story />
			</QueryClientProvider>
		),
	],
	args: {
		onBack: () => {},
		onConnected: () => {},
	},
};
export default meta;

type Story = StoryObj<typeof StepMicrosoftEmail>;

export const Choice: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("checkbox", { name: /Mail/ })).toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: /Calendar/ }),
		).toBeChecked();
	},
};

export const NothingPicked: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("checkbox", { name: /Mail/ }));
		await userEvent.click(canvas.getByRole("checkbox", { name: /Calendar/ }));
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();
	},
};

export const ScopeNotGranted: Story = {
	args: { refusal: mapOauthError("scope_not_granted") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/did not grant access to every service you picked/),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();
	},
};

export const GrantedCalendarOnly: StoryObj<typeof AccountGranted> = {
	render: () => (
		<AccountGranted
			account={{
				accountId: "acc-outlook",
				email: "alice@outlook.com",
				syncedServices: ["Calendar"],
				grantedScopes: ["https://graph.microsoft.com/Calendars.Read"],
			}}
			onContinue={() => {}}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Access granted — syncing")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Continue" }),
		).toBeEnabled();
	},
};

export const GrantedMailAndCalendar: StoryObj<typeof AccountGranted> = {
	render: () => (
		<AccountGranted
			account={{
				accountId: "acc-outlook",
				email: "alice@outlook.com",
				syncedServices: ["Mail", "Calendar"],
				grantedScopes: [
					"https://outlook.office.com/IMAP.AccessAsUser.All",
					"https://outlook.office.com/SMTP.Send",
					"https://graph.microsoft.com/Calendars.Read",
				],
			}}
			onContinue={() => {}}
		/>
	),
};
