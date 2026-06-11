/**
 * DraftsView — segmented Drafts folder view.
 *
 * Renders two labeled sections when the open mailbox is an account's IMAP
 * \Drafts special-use folder (issue #505):
 *
 *   1. "Not yet sent (Remit)" — outbox rows with status === "draft" belonging
 *      to the account that owns the open \Drafts mailbox. Clicking a row opens
 *      compose pre-filled via openCompose({ mode: "new", outboxMessageId }).
 *
 *   2. "On the server" — IMAP \Drafts thread rows already loaded for the
 *      mailbox. Clicking a row opens the normal reading pane (read-only;
 *      editing IMAP drafts in compose is a known follow-up gap).
 *
 * Reuses the remit-ui ThreadSection / sectioned-list machinery that the Daily
 * Brief also uses — sticky section headers, ComfortableRow / CompactRow with
 * density. No new sectioned-list code is introduced here.
 *
 * Dedup note: Remit draft rows and IMAP \Drafts messages have no shared key
 * today (no IMAP APPEND-as-draft path exists). Both sections render without
 * client-side dedup; if appending Remit drafts into IMAP \Drafts ships in the
 * future the dedup key would be the RFC822 Message-ID header (issue #505).
 */
import { outboxOperationsListOutboxMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Avatar,
	ComfortableRowTextContent,
	cn,
	comfortableRowClass,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Inbox } from "lucide-react";
import { useMemo } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { groupDraftSections } from "@/lib/drafts";

// ---------------------------------------------------------------------------
// Section header (mirrors DailyBrief SectionHeader)
// ---------------------------------------------------------------------------

const SectionHeader = ({ label, count }: { label: string; count: number }) => (
	<div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-line bg-surface-sunken px-row-inset py-1">
		<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
			{label}
		</span>
		<span className="text-2xs text-fg-subtle tabular-nums">{count}</span>
	</div>
);

// ---------------------------------------------------------------------------
// Remit-draft row — opens compose for editing
// ---------------------------------------------------------------------------

interface RemitDraftRowProps {
	row: ThreadRowData;
	isSelected: boolean;
	onOpen: (outboxMessageId: string) => void;
}

const RemitDraftRow = ({ row, isSelected, onOpen }: RemitDraftRowProps) => (
	<button
		type="button"
		onClick={() => onOpen(row.id)}
		className={cn("group", comfortableRowClass({ active: isSelected }))}
	>
		<FileText className="size-7 shrink-0 text-fg-muted mt-0.5" />
		<ComfortableRowTextContent thread={row} />
	</button>
);

// ---------------------------------------------------------------------------
// IMAP-draft row — opens reading pane (read-only)
// ---------------------------------------------------------------------------

interface ImapDraftRowProps {
	row: ThreadRowData;
	isSelected: boolean;
	onOpen: (messageId: string) => void;
}

const ImapDraftRow = ({ row, isSelected, onOpen }: ImapDraftRowProps) => {
	const unread = !row.isRead;
	return (
		<button
			type="button"
			onClick={() => onOpen(row.id)}
			className={cn("group", comfortableRowClass({ active: isSelected }))}
		>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<Avatar name={row.fromName} email={row.fromEmail} size="sm" />
			<ComfortableRowTextContent thread={row} />
		</button>
	);
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DraftsViewProps {
	/** The mailbox id for the \Drafts mailbox being viewed. */
	mailboxId: string;
	/** The accountId that owns this \Drafts mailbox. */
	accountId: string;
	/** The currently selected message id (reading pane). */
	selectedMessageId?: string;
	/** IMAP thread rows already loaded for the \Drafts mailbox. */
	imapThreads: RemitImapThreadMessageResponse[];
	/** Mailbox display name (e.g. "Drafts"). */
	title: string;
	/** Total unread count for the header. */
	unreadCount?: number;
}

export function DraftsView({
	mailboxId,
	accountId,
	selectedMessageId,
	imapThreads,
	title,
	unreadCount,
}: DraftsViewProps) {
	const { openCompose } = useCompose();
	const navigate = useNavigate();

	// Fetch the full outbox list — both sources are already fetched by the
	// client; this is a pure client-side composition (issue #505).
	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const sections = useMemo<ThreadSection[]>(() => {
		return groupDraftSections({
			outboxMessages: outboxResponse?.items ?? [],
			accountId,
			imapThreads,
		});
	}, [outboxResponse?.items, accountId, imapThreads]);

	const handleRemitDraftOpen = (outboxMessageId: string) => {
		// Clear any open IMAP draft first. The route's detailPane only renders
		// FullCompose when `composeState.isOpen && !selectedThread`; if an IMAP
		// draft is open (selectedMessageId set) the reading pane would keep
		// showing ConversationView and compose would never surface (#505).
		if (selectedMessageId) {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: { selectedMessageId: undefined },
			});
		}
		openCompose({ mode: "new", outboxMessageId });
	};

	const handleImapDraftOpen = (messageId: string) => {
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: { selectedMessageId: messageId },
		});
	};

	const isEmpty = sections.length === 0;

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			{/* List datum bar */}
			<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
				<h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
				{(unreadCount ?? 0) > 0 && (
					<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
						{unreadCount} unread
					</span>
				)}
			</header>

			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto">
				{isEmpty ? (
					<div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
						<Inbox className="size-8 text-fg-subtle" />
						<p className="text-sm font-medium text-fg">No drafts</p>
						<p className="text-xs text-fg-subtle">
							Messages you start composing will appear here.
						</p>
					</div>
				) : (
					sections.map((section) => (
						<div key={section.id}>
							{section.label && (
								<SectionHeader
									label={section.label}
									count={section.threads.length}
								/>
							)}
							<div className="divide-y divide-line">
								{section.threads.map((thread) => {
									if (section.id === "remit-drafts") {
										return (
											<RemitDraftRow
												key={thread.id}
												row={thread}
												isSelected={thread.id === selectedMessageId}
												onOpen={handleRemitDraftOpen}
											/>
										);
									}
									return (
										<ImapDraftRow
											key={thread.id}
											row={thread}
											isSelected={thread.id === selectedMessageId}
											onOpen={handleImapDraftOpen}
										/>
									);
								})}
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}
