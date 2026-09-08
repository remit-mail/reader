import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	ACCOUNT_SERVICE_EMPTY_MESSAGE,
	AccountServiceChoice,
	type AccountServiceId,
} from "./account-service-choice.js";

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

const bothServices: AccountServiceId[] = ["Mail", "Calendar"];

function LiveChoice({
	initial,
	offered = bothServices,
}: {
	initial: AccountServiceId[];
	offered?: AccountServiceId[];
}) {
	const [selected, setSelected] = useState(initial);
	return (
		<AccountServiceChoice
			providerName="Microsoft"
			offered={offered}
			selected={selected}
			onChange={setSelected}
			error={selected.length === 0 ? ACCOUNT_SERVICE_EMPTY_MESSAGE : undefined}
		/>
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
 * Neither ticked. The choice says what is wrong instead of going quiet, and
 * its host refuses to submit the empty set.
 */
export const NeitherSelected: Story = {
	render: () => <LiveChoice initial={[]} />,
};

/**
 * A provider that only syncs mail. The choice is absent, not a disabled row —
 * the border below is the whole render.
 */
export const MailOnlyProvider: Story = {
	render: () => (
		<>
			<LiveChoice initial={["Mail"]} offered={["Mail"]} />
			<p className="border-t border-line pt-2 text-2xs text-fg-subtle">
				Nothing above this line: an IMAP account syncs mail and is not asked.
			</p>
		</>
	),
};
