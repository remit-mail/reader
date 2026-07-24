import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { BottomSheet } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { OrganizePanel } from "./OrganizePanel";
import type { FolderOption } from "./SomethingElsePanel";
import { SomethingElsePanel } from "./SomethingElsePanel";

/**
 * `Flows/Smart Organize` — the guided select-similar → organize flow (issue
 * #211), rendered from the real web-client components, not a prototype copy:
 * the same {@link OrganizePanel} the desktop dialog and the mobile sheet use,
 * and the same {@link SomethingElsePanel} the flow seeds from. The prototype's
 * interactive `Inbox` / `Walkthrough` stories live alongside these in the
 * workbench; these show each in-sheet panel in isolation so they can't drift
 * from what ships.
 */

const ACCOUNT_ID = "acc-1";

const makeMailbox = (
	mailboxId: string,
	fullPath: string,
): RemitImapMailboxResponse => ({
	mailboxId,
	accountId: ACCOUNT_ID,
	namespaceType: "personal",
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	fullPath,
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: 0,
	createdAt: 0,
	updatedAt: 0,
});

const MAILBOXES: RemitImapMailboxResponse[] = [
	makeMailbox("mbx-inbox", "INBOX"),
	makeMailbox("mbx-archive", "Archive"),
	makeMailbox("mbx-receipts", "Receipts"),
	makeMailbox("mbx-travel", "Travel"),
	makeMailbox("mbx-junk", "Junk"),
];

const FOLDER_OPTIONS: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
	{ id: "mbx-receipts", label: "Receipts" },
	{ id: "mbx-junk", label: "Junk" },
];

/**
 * A QueryClient pre-seeded with the account's mailboxes, so the sentence's
 * folder picker renders its real options without a network round-trip.
 */
function seededClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(
		mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT_ID } }),
		{ items: MAILBOXES },
	);
	return client;
}

/** Phone frame + a bottom sheet holding the panel, mirroring the mobile home. */
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
	title: "Flows/Smart Organize",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The organize sentence on a widened selection — folder picker + four scopes. */
export const Organize: Story = {
	render: () => (
		<SheetStage>
			<OrganizePanel
				accountId={ACCOUNT_ID}
				mailboxId="mbx-inbox"
				selectedMessageIds={["msg-1", "msg-2", "msg-3"]}
				anchorMessageId="msg-1"
				matchedCount={47}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * A larger widen — the same sentence over a broad match set, as when the anchor
 * is a common sender.
 */
export const FromSearch: Story = {
	name: "From Search",
	render: () => (
		<SheetStage>
			<OrganizePanel
				accountId={ACCOUNT_ID}
				mailboxId="mbx-inbox"
				selectedMessageIds={["msg-1"]}
				anchorMessageId="msg-1"
				matchedCount={412}
				seedMailboxId="mbx-archive"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The standing scope pre-selected — the "Always keep…" sentence + filter name. */
export const AlwaysRule: Story = {
	name: "Always Rule",
	render: () => (
		<SheetStage>
			<OrganizePanel
				accountId={ACCOUNT_ID}
				mailboxId="mbx-inbox"
				selectedMessageIds={["msg-1", "msg-2"]}
				anchorMessageId="msg-1"
				matchedCount={47}
				initialScope="standing"
				seedMailboxId="mbx-travel"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The widen matched nothing — the sentence organizes just the selection. */
export const NoSimilarFound: Story = {
	name: "No Similar Found",
	render: () => (
		<SheetStage>
			<OrganizePanel
				accountId={ACCOUNT_ID}
				mailboxId="mbx-inbox"
				selectedMessageIds={["msg-1", "msg-2"]}
				anchorMessageId="msg-1"
				matchedCount={0}
				fallback
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The "Something else" fallback: shortcuts derived from folders + an input. */
export const SomethingElse: Story = {
	render: () => (
		<SheetStage>
			<SomethingElsePanel
				folderOptions={FOLDER_OPTIONS}
				junkMailboxId="mbx-junk"
				onSeed={() => undefined}
			/>
		</SheetStage>
	),
};
