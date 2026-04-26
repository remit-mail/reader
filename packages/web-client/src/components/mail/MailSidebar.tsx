import {
	mailboxOperationsListMailboxesOptions,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, File, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayName as getDisplayName,
	getMailboxPriority,
	isSystemMailbox,
} from "@/lib/mailbox-order";
import { useCompose } from "../compose/ComposeProvider";
import { MailboxItem } from "./MailboxItem";

interface MailSidebarProps {
	accounts: RemitImapAccountResponse[];
}

const startsWithDigit = (str: string): boolean => /^\d/.test(str);

const compareLabelNames = (a: string, b: string): number => {
	const aStartsWithDigit = startsWithDigit(a);
	const bStartsWithDigit = startsWithDigit(b);

	if (aStartsWithDigit && !bStartsWithDigit) return -1;
	if (!aStartsWithDigit && bStartsWithDigit) return 1;

	return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
};

const sortMailboxes = (
	mailboxes: RemitImapMailboxResponse[],
): {
	system: RemitImapMailboxResponse[];
	labels: RemitImapMailboxResponse[];
} => {
	const filtered = filterDuplicateSpecialUse(mailboxes);

	const system: RemitImapMailboxResponse[] = [];
	const labels: RemitImapMailboxResponse[] = [];

	for (const mailbox of filtered) {
		if (isSystemMailbox(mailbox.fullPath)) {
			system.push(mailbox);
		} else {
			labels.push(mailbox);
		}
	}

	system.sort(
		(a, b) => getMailboxPriority(a.fullPath) - getMailboxPriority(b.fullPath),
	);
	labels.sort((a, b) =>
		compareLabelNames(getDisplayName(a.fullPath), getDisplayName(b.fullPath)),
	);

	return { system, labels };
};

const MAX_VISIBLE_LABELS = 13;

const DraftsList = () => {
	const [expanded, setExpanded] = useState(true);
	const { openCompose } = useCompose();

	const {
		data: outboxResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(outboxOperationsListOutboxMessagesOptions());

	const drafts = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) => item.status === "draft"),
		[outboxResponse?.items],
	);

	if (isError) {
		return (
			<div className="mb-2 px-3 py-2">
				<ErrorState
					variant="inline"
					title="Couldn't load drafts"
					error={error}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	if (isLoading || drafts.length === 0) return null;

	return (
		<div className="mb-2">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-1 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				<span>Drafts</span>
				<span className="ml-auto text-xs font-normal bg-muted px-1.5 py-0.5 rounded-full">
					{drafts.length}
				</span>
			</button>
			{expanded && (
				<div className="space-y-0.5">
					{drafts.map((draft) => (
						<button
							key={draft.outboxMessageId}
							type="button"
							onClick={() =>
								openCompose({
									mode: "new",
									outboxMessageId: draft.outboxMessageId,
								})
							}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors"
						>
							<File className="size-4 shrink-0 text-muted-foreground" />
							<span className="truncate">{draft.subject || "No subject"}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
};

const OutboxLink = () => {
	const location = useLocation();
	const isSelected = location.pathname.startsWith("/mail/outbox");

	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const pendingCount = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) => item.status !== "draft")
				.length,
		[outboxResponse?.items],
	);

	return (
		<Link
			to="/mail/outbox"
			className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-accent ${
				isSelected ? "bg-accent font-medium" : ""
			}`}
		>
			<Send className="size-4 shrink-0" />
			<span className="flex-1 truncate">Outbox</span>
			{pendingCount > 0 && (
				<span className="text-xs font-normal bg-muted px-1.5 py-0.5 rounded-full">
					{pendingCount}
				</span>
			)}
		</Link>
	);
};

const AccountSection = ({ account }: { account: RemitImapAccountResponse }) => {
	const [expanded, setExpanded] = useState(true);
	const [labelsExpanded, setLabelsExpanded] = useState(false);
	const params = useParams({ strict: false });
	const selectedMailboxId = params.mailboxId as string | undefined;

	const {
		data: mailboxesResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: account.accountId },
		}),
		// Mailboxes change rarely (only on add/rename/delete). Cache forever
		// and rely on explicit invalidation from those mutations. Avoids the
		// 30s background refetch that flashes the sidebar.
		staleTime: Infinity,
	});

	const { system, labels } = useMemo(
		() => sortMailboxes(mailboxesResponse?.items ?? []),
		[mailboxesResponse?.items],
	);

	return (
		<div className="mb-4">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-1 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				<span className="truncate">{account.email}</span>
			</button>
			{expanded && (
				<>
					{isLoading ? (
						<div className="px-3 py-2 text-sm text-muted-foreground">
							Loading...
						</div>
					) : isError ? (
						<div className="px-3 py-2">
							<ErrorState
								variant="inline"
								title="Couldn't load mailboxes"
								error={error}
								onRetry={() => refetch()}
							/>
						</div>
					) : system.length === 0 && labels.length === 0 ? (
						<div className="px-3 py-2 text-sm text-muted-foreground">
							No mailboxes
						</div>
					) : (
						<>
							<div className="space-y-0.5">
								{system.map((mailbox) => (
									<MailboxItem
										key={mailbox.mailboxId}
										mailbox={mailbox}
										isSelected={selectedMailboxId === mailbox.mailboxId}
									/>
								))}
								<OutboxLink />
							</div>
							{labels.length > 0 && (
								<>
									<div className="my-2 mx-3 border-t border-border" />
									<div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
										Labels
									</div>
									<div className="space-y-0.5">
										{(labelsExpanded
											? labels
											: labels.slice(0, MAX_VISIBLE_LABELS)
										).map((mailbox) => (
											<MailboxItem
												key={mailbox.mailboxId}
												mailbox={mailbox}
												isSelected={selectedMailboxId === mailbox.mailboxId}
											/>
										))}
										{labels.length > MAX_VISIBLE_LABELS && (
											<button
												type="button"
												onClick={() => setLabelsExpanded(!labelsExpanded)}
												className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
											>
												{labelsExpanded ? (
													<>
														<ChevronDown className="size-4 shrink-0" />
														<span>Less</span>
													</>
												) : (
													<>
														<ChevronRight className="size-4 shrink-0" />
														<span>
															More ({labels.length - MAX_VISIBLE_LABELS})
														</span>
													</>
												)}
											</button>
										)}
									</div>
								</>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
};

export const MailSidebar = ({ accounts }: MailSidebarProps) => (
	<nav className="h-full overflow-y-auto py-2" aria-label="Mailboxes">
		<DraftsList />
		{accounts.length === 0 ? (
			<div className="px-3 py-4 text-sm text-muted-foreground text-center">
				No accounts configured
			</div>
		) : (
			accounts.map((account) => (
				<AccountSection key={account.accountId} account={account} />
			))
		)}
	</nav>
);
