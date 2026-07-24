import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { BottomSheet, type FolderOption } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { FilterEditor } from "./FilterEditor";

/**
 * `Flows/Settings Filters` — editing a standing filter in the same chip editor
 * the Organize surface uses (RFC 038 D6), rendered from the real web-client
 * component the settings page mounts. Each story opens a persisted filter into
 * the editor: a literal rule, an anchored rule with its widen chip, an
 * until-a-date rule, and the degraded case where the deployment cannot evaluate
 * the anchor and the widen lists inactive (D4).
 */

const ACCOUNT_ID = "acc-1";

const FOLDERS: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
	{ id: "mbx-receipts", label: "Receipts" },
	{ id: "mbx-travel", label: "Travel" },
];

const makeFilter = (
	overrides: Partial<RemitImapFilterResponse> = {},
): RemitImapFilterResponse => ({
	filterId: "f-1",
	accountConfigId: ACCOUNT_ID,
	name: "Receipts",
	scope: "Standing",
	state: "Active",
	hasAnchor: false,
	ruleChangedAt: 0,
	matchOperator: "And",
	literalClauses: [
		{ field: "From", value: "receipts@stripe.com" },
		{ field: "Subject", value: "invoice" },
	],
	actionLabelId: "None",
	actionMailboxId: "mbx-receipts",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

/** A client whose preview never resolves, so the editor holds its opening count. */
function seededClient(): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
}

/** Phone frame + a bottom sheet holding the editor, mirroring the mobile home. */
function SheetStage({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={seededClient()}>
			<ErrorBannerProvider>
				<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[760px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
					<div className="divide-y divide-line opacity-50">
						{Array.from({ length: 8 }).map((_, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: static backdrop skeleton, no ids
								key={index}
								className="flex items-start gap-3 px-row-inset py-2.5"
							>
								<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
								<div className="min-w-0 flex-1 space-y-1">
									<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
									<div className="h-2 w-2/3 rounded bg-surface-sunken" />
								</div>
							</div>
						))}
					</div>
					<BottomSheet open onClose={() => undefined}>
						{children}
					</BottomSheet>
				</div>
			</ErrorBannerProvider>
		</QueryClientProvider>
	);
}

const meta: Meta = {
	title: "Flows/Settings Filters",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** A standing literal filter opened for editing. */
export const EditStandingRule: Story = {
	name: "Edit Standing Rule",
	render: () => (
		<SheetStage>
			<FilterEditor
				accountId={ACCOUNT_ID}
				filter={makeFilter()}
				folders={FOLDERS}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** A filter with a semantic anchor — the widen lists as an active chip. */
export const EditAnchoredRule: Story = {
	name: "Edit Anchored Rule",
	render: () => (
		<SheetStage>
			<FilterEditor
				accountId={ACCOUNT_ID}
				filter={makeFilter({ hasAnchor: true, name: "GitHub" })}
				folders={FOLDERS}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** A temporary filter — the scope loads as until-a-date with the stored date. */
export const EditUntilADate: Story = {
	name: "Edit Until A Date",
	render: () => (
		<SheetStage>
			<FilterEditor
				accountId={ACCOUNT_ID}
				filter={makeFilter({
					name: "Conference",
					scope: "Temporary",
					expiresAt: "2027-09-01T23:59:59+00:00",
				})}
				folders={FOLDERS}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * The deployment cannot evaluate the filter's anchor (RFC 038 D4): the widen
 * chip lists inactive, the rule matches by its literal clauses only, and the
 * dead anchor is removable.
 */
export const DegradedAnchor: Story = {
	name: "Degraded Anchor",
	render: () => (
		<SheetStage>
			<FilterEditor
				accountId={ACCOUNT_ID}
				filter={makeFilter({ hasAnchor: true, name: "Newsletters" })}
				folders={FOLDERS}
				semanticUnavailable
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};
