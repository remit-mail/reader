import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
	ACCOUNT_SERVICE_EMPTY_MESSAGE,
	type AccountService,
	AccountServiceChoice,
} from "./account-service-choice.js";
import { Button } from "./button.js";

/**
 * What an account syncs, asked once before the provider redirect so the
 * consent screen matches the pick (#1178).
 */
const meta: Meta<typeof AccountServiceChoice> = {
	title: "Components/AccountServiceChoice",
	component: AccountServiceChoice,
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

type Story = StoryObj<typeof AccountServiceChoice>;

const bothServices: AccountService[] = ["Mail", "Calendar"];

/**
 * Stands in for the host: the refusal appears on a refused Continue, the way
 * the onboarding step raises it, not the moment the set goes empty.
 */
function LiveChoice({
	initial,
	offered = bothServices,
}: {
	initial: AccountService[];
	offered?: AccountService[];
}) {
	const [selected, setSelected] = useState(initial);
	const [refused, setRefused] = useState(false);
	const empty = selected.length === 0;
	return (
		<div className="space-y-3">
			<AccountServiceChoice
				providerName="Microsoft"
				offered={offered}
				selected={selected}
				onChange={setSelected}
				error={refused && empty ? ACCOUNT_SERVICE_EMPTY_MESSAGE : undefined}
			/>
			<Button variant="primary" onClick={() => setRefused(empty)}>
				Continue
			</Button>
		</div>
	);
}

/** A provider that syncs both. Both on is the default a host arrives with. */
export const BothServices: Story = {
	render: () => <LiveChoice initial={bothServices} />,
};

/** Calendar only — the Outlook account kept for its calendar and nothing else. */
export const CalendarOnly: Story = {
	render: () => <LiveChoice initial={["Calendar"]} />,
};

/**
 * Neither ticked. Continue says what is wrong instead of going quiet, and its
 * host refuses to submit the empty set.
 */
export const NeitherSelected: Story = {
	render: () => <LiveChoice initial={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("alert")).toBeNull();
		await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
	},
};

/**
 * A provider that only syncs mail. The rows are absent, not a disabled row —
 * the border below is the whole render.
 */
export const MailOnlyProvider: Story = {
	render: () => (
		<>
			<AccountServiceChoice
				providerName="Microsoft"
				offered={["Mail"]}
				selected={["Mail"]}
				onChange={() => {}}
			/>
			<p className="border-t border-line pt-2 text-2xs text-fg-subtle">
				Nothing above this line: an IMAP account syncs mail and is not asked.
			</p>
		</>
	),
};

/**
 * One service on offer and none picked. There is nothing to tick, so the
 * refusal is the whole render — the host's Continue must not go quiet.
 */
export const MailOnlyProviderRefused: Story = {
	render: () => <LiveChoice initial={[]} offered={["Mail"]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
	},
};
