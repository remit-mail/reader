import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FiltersList } from "./FiltersList";

const NOW = Date.parse("2026-09-25T12:00:00Z");

const meta: Meta<typeof FiltersList> = {
	title: "Playground/Shipped/Settings/Filters/FiltersList",
	component: FiltersList,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md">
				<Story />
			</div>
		),
	],
	args: {
		mailboxName: (mailboxId: string) =>
			mailboxId === "mbx-invoices" ? "Invoices" : undefined,
		labelById: new Map(),
		onEdit: () => undefined,
		onDelete: () => undefined,
		onToggle: () => undefined,
		now: NOW,
	},
};
export default meta;

type Story = StoryObj<typeof FiltersList>;

const makeFilter = (
	overrides: Partial<RemitImapFilterResponse>,
): RemitImapFilterResponse => ({
	filterId: "flt-1",
	accountConfigId: "acc-1",
	name: "Invoices",
	scope: "Standing",
	state: "Active",
	disabledReason: "None",
	hasAnchor: false,
	ruleChangedAt: 0,
	actionChangedAt: 0,
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "billing@example.com" }],
	actionLabelId: "None",
	actionMailboxId: "mbx-invoices",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const disabled = (
	reason: RemitImapFilterResponse["disabledReason"],
	overrides: Partial<RemitImapFilterResponse> = {},
): RemitImapFilterResponse[] => [
	makeFilter({ state: "Disabled", disabledReason: reason, ...overrides }),
];

export const Active: Story = {
	args: { filters: [makeFilter({})] },
};

export const TurnedOffByUser: Story = {
	args: { filters: disabled("UserDisabled") },
};

export const AwaitingFolder: Story = {
	args: { filters: disabled("AwaitingFolder", { actionMailboxId: "None" }) },
};

export const FolderCreateFailed: Story = {
	args: {
		filters: disabled("FolderCreateFailed", { actionMailboxId: "None" }),
	},
};

export const FolderMissing: Story = {
	args: {
		filters: disabled("FolderMissing", { actionMailboxId: "mbx-deleted" }),
	},
};

export const Toggling: Story = {
	args: {
		filters: disabled("UserDisabled"),
		togglingFilterId: "flt-1",
	},
};
