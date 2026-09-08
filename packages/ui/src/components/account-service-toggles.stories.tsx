import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { AccountService } from "./account-service-choice.js";
import {
	type AccountServiceIntent,
	AccountServiceToggles,
} from "./account-service-toggles.js";

/**
 * What an account syncs, on its settings screen (#1179). The switch asks; the
 * host confirms and commits.
 */
const meta: Meta<typeof AccountServiceToggles> = {
	title: "Components/AccountServiceToggles",
	component: AccountServiceToggles,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-4">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof AccountServiceToggles>;

const bothServices: AccountService[] = ["Mail", "Calendar"];

/**
 * Stands in for the host that owns the change: the switch reports the ask and
 * nothing moves until the host answers it, which is what these stories show.
 */
function Toggles({
	enabled,
	consented = bothServices,
	offered = bothServices,
	onRequestChange = () => {},
}: {
	enabled: AccountService[];
	consented?: AccountService[];
	offered?: AccountService[];
	onRequestChange?: (
		service: AccountService,
		intent: AccountServiceIntent,
	) => void;
}) {
	return (
		<AccountServiceToggles
			providerName="Microsoft"
			offered={offered}
			enabled={enabled}
			consented={consented}
			onRequestChange={onRequestChange}
		/>
	);
}

/** Both services on: the state an Outlook account arrives in from onboarding. */
export const BothOn: Story = {
	render: () => <Toggles enabled={bothServices} />,
};

/**
 * Mail off. The switch is the only thing that changed — the account keeps its
 * place and its stored mail, which the other surfaces say for themselves.
 */
export const MailOff: Story = {
	render: () => <Toggles enabled={["Calendar"]} />,
};

/**
 * Calendar was never consented to. The row says what turning it on costs before
 * it is pressed, because no saved setting can grant a scope.
 */
export const CalendarNeedsConsent: Story = {
	render: () => <Toggles enabled={["Mail"]} consented={["Mail"]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/signing in with Microsoft again/),
		).toBeVisible();
	},
};

/**
 * Pressing a running service asks to switch it off. Nothing moves on screen:
 * the host raises the confirmation and owns the change.
 */
export const AsksBeforeItMoves: Story = {
	render: () => <Toggles enabled={bothServices} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const mail = canvas.getByRole("switch", { name: "Sync mail" });
		await userEvent.click(mail);
		await expect(mail).toBeChecked();
	},
};

/**
 * An IMAP account. It syncs mail and nothing else, so there is nothing to
 * switch — the border below is the whole render.
 */
export const ImapAccount: Story = {
	render: () => (
		<>
			<AccountServiceToggles
				providerName="Fastmail"
				offered={["Mail"]}
				enabled={["Mail"]}
				consented={["Mail"]}
				onRequestChange={() => {}}
			/>
			<p className="border-t border-line pt-2 text-2xs text-fg-subtle">
				Nothing above this line: an IMAP account syncs mail and is not asked.
			</p>
		</>
	),
};
