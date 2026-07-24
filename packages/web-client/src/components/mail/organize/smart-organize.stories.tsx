import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { BottomSheet } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { OrganizeRuleEditor } from "./OrganizeRuleEditor";
import type { FolderOption } from "./SomethingElsePanel";
import { SomethingElsePanel } from "./SomethingElsePanel";

/**
 * `Flows/Smart Organize` — the Organize surface as the chip editor (RFC 038 D1),
 * rendered from the real web-client component the desktop dialog and the mobile
 * sheet both mount, not a prototype copy. Each story opens the editor on a
 * seeded state — a widen-anchored rule, the sender-fallback clauses (#251), a
 * pre-seeded standing rule, and the capability-absent cases — so the surface
 * can't drift from what ships.
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
 * A QueryClient pre-seeded with the account's mailboxes, so the editor's folder
 * picker renders its real options without a network round-trip.
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
	title: "Flows/Smart Organize",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The rule editor on a widened selection — the widen chip and a live count. */
export const Organize: Story = {
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2", "msg-3"]}
				seedCount={47}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** A larger widen — the same editor over a broad match set. */
export const FromSearch: Story = {
	name: "From Search",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1"]}
				seedCount={412}
				seedMailboxId="mbx-archive"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The standing scope pre-selected — the rule that keeps working on new mail. */
export const AlwaysRule: Story = {
	name: "Always Rule",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2"]}
				seedCount={47}
				seedScope="standing"
				seedMailboxId="mbx-travel"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * The deployment ships no vector pipeline and the selection has no senders to
 * match on — the widen is not offered and the rule opens empty, awaiting a
 * clause (#226/#201).
 */
export const SemanticUnavailable: Story = {
	name: "Semantic Unavailable",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2"]}
				seedCount={0}
				semanticUnavailable
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * No vector pipeline, but the selection has senders to match on — the widen fell
 * back to the sender `From` clauses (#251). The senders span different domains,
 * so the fallback keeps one editable `From` chip per address, combined with
 * "or". Every commit carries exactly these clauses.
 */
export const SenderFallback: Story = {
	name: "Sender Fallback",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2"]}
				seedCount={128}
				semanticUnavailable
				senders={["npm@github.com", "noreply@medium.com"]}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * The sender fallback where every selected sender shares one registrable domain
 * (RFC 038 D2): the per-address `From` chips collapse to a single `FromDomain`
 * chip — "anyone at github.com" — rather than listing addresses. Matches
 * `sub.github.com` too, never a look-alike like `github.com.evil.example`.
 */
export const SenderFallbackDomain: Story = {
	name: "Sender Fallback (domain)",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2", "msg-3"]}
				seedCount={342}
				semanticUnavailable
				senders={[
					"npm@github.com",
					"notifications@github.com",
					"ci@sub.github.com",
				]}
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The sender fallback with a standing rule pre-selected. */
export const SenderFallbackStanding: Story = {
	name: "Sender Fallback (standing)",
	render: () => (
		<SheetStage>
			<OrganizeRuleEditor
				accountId={ACCOUNT_ID}
				selectedMessageIds={["msg-1", "msg-2", "msg-3", "msg-4"]}
				seedCount={412}
				semanticUnavailable
				senders={[
					"npm@github.com",
					"notifications@github.com",
					"noreply@medium.com",
					"digest@substack.com",
				]}
				seedScope="standing"
				seedMailboxId="mbx-archive"
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
