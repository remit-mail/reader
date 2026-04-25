import {
	mailboxOperationsListMailboxesOptions,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
	RemitImapOutboxMessageStatus,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	File,
	Loader2,
	Send,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCompose } from "../compose/ComposeProvider";
import { MailboxItem } from "./MailboxItem";

interface MailSidebarProps {
	accounts: RemitImapAccountResponse[];
}

const SYSTEM_MAILBOX_ORDER = [
	"inbox",
	"starred",
	"flagged",
	"sent",
	"drafts",
	"draft",
	"all",
	"archive",
	"spam",
	"junk",
	"trash",
	"deleted",
] as const;

const getMailboxPriority = (fullPath: string): number => {
	const name = fullPath.toLowerCase();
	for (let i = 0; i < SYSTEM_MAILBOX_ORDER.length; i++) {
		if (name.includes(SYSTEM_MAILBOX_ORDER[i])) {
			return i;
		}
	}
	return SYSTEM_MAILBOX_ORDER.length;
};

const isSystemMailbox = (fullPath: string): boolean =>
	getMailboxPriority(fullPath) < SYSTEM_MAILBOX_ORDER.length;

const getDisplayName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return parts[parts.length - 1] || fullPath;
};

const startsWithDigit = (str: string): boolean => /^\d/.test(str);

const compareLabelNames = (a: string, b: string): number => {
	const aStartsWithDigit = startsWithDigit(a);
	const bStartsWithDigit = startsWithDigit(b);

	if (aStartsWithDigit && !bStartsWithDigit) return -1;
	if (!aStartsWithDigit && bStartsWithDigit) return 1;

	return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
};

const SPECIAL_USE_ALIASES: Record<string, string> = {
	trash: "trash",
	bin: "trash",
	deleted: "trash",
	"deleted items": "trash",
	drafts: "drafts",
	draft: "drafts",
	sent: "sent",
	"sent mail": "sent",
	"sent items": "sent",
	junk: "junk",
	spam: "junk",
	archive: "archive",
	archives: "archive",
	all: "all",
	"all mail": "all",
};

const filterDuplicateSpecialUse = (
	mailboxes: RemitImapMailboxResponse[],
): RemitImapMailboxResponse[] => {
	const prefixedSpecialUse = new Set<string>();
	for (const mailbox of mailboxes) {
		const name = getDisplayName(mailbox.fullPath).toLowerCase();
		const specialUseType = SPECIAL_USE_ALIASES[name];
		if (mailbox.fullPath.includes("/") && specialUseType) {
			prefixedSpecialUse.add(specialUseType);
		}
	}

	return mailboxes.filter((mailbox) => {
		const name = getDisplayName(mailbox.fullPath).toLowerCase();
		const specialUseType = SPECIAL_USE_ALIASES[name];
		if (!specialUseType) return true;
		if (mailbox.fullPath.includes("/")) return true;
		return !prefixedSpecialUse.has(specialUseType);
	});
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

	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const drafts = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) => item.status === "draft"),
		[outboxResponse?.items],
	);

	if (drafts.length === 0) return null;

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

const STATUS_ICON: Record<
	Exclude<RemitImapOutboxMessageStatus, "draft">,
	typeof Send
> = {
	queued: Clock,
	sending: Loader2,
	sent: Send,
	failed: AlertCircle,
};

const OutboxList = () => {
	const [expanded, setExpanded] = useState(true);

	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const outboxMessages = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) => item.status !== "draft"),
		[outboxResponse?.items],
	);

	if (outboxMessages.length === 0) return null;

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
				<span>Outbox</span>
				<span className="ml-auto text-xs font-normal bg-muted px-1.5 py-0.5 rounded-full">
					{outboxMessages.length}
				</span>
			</button>
			{expanded && (
				<div className="space-y-0.5">
					{outboxMessages.map((msg) => {
						const status = msg.status as Exclude<
							RemitImapOutboxMessageStatus,
							"draft"
						>;
						const Icon = STATUS_ICON[status] ?? Send;
						return (
							<Link
								key={msg.outboxMessageId}
								to="/mail/outbox"
								className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors"
							>
								<Icon className="size-4 shrink-0 text-muted-foreground" />
								<span className="truncate">{msg.subject || "No subject"}</span>
							</Link>
						);
					})}
				</div>
			)}
		</div>
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
		<OutboxList />
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
