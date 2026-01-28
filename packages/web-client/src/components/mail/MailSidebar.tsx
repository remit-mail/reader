import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { MailboxItem } from "./MailboxItem";

interface MailSidebarProps {
	accounts: RemitImapAccountResponse[];
}

// Standard mailbox order (case-insensitive matching)
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
	return SYSTEM_MAILBOX_ORDER.length; // Custom mailboxes come last
};

const isSystemMailbox = (fullPath: string): boolean =>
	getMailboxPriority(fullPath) < SYSTEM_MAILBOX_ORDER.length;

const sortMailboxes = (
	mailboxes: RemitImapMailboxResponse[],
): {
	system: RemitImapMailboxResponse[];
	labels: RemitImapMailboxResponse[];
} => {
	const system: RemitImapMailboxResponse[] = [];
	const labels: RemitImapMailboxResponse[] = [];

	for (const mailbox of mailboxes) {
		if (isSystemMailbox(mailbox.fullPath)) {
			system.push(mailbox);
		} else {
			labels.push(mailbox);
		}
	}

	system.sort(
		(a, b) => getMailboxPriority(a.fullPath) - getMailboxPriority(b.fullPath),
	);
	labels.sort((a, b) => a.fullPath.localeCompare(b.fullPath));

	return { system, labels };
};

const AccountSection = ({ account }: { account: RemitImapAccountResponse }) => {
	const [expanded, setExpanded] = useState(true);
	const params = useParams({ strict: false });
	const selectedMailboxId = params.mailboxId as string | undefined;

	const { data: mailboxesResponse, isLoading } = useQuery(
		mailboxOperationsListMailboxesOptions({
			path: { accountId: account.accountId },
		}),
	);

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
										{labels.map((mailbox) => (
											<MailboxItem
												key={mailbox.mailboxId}
												mailbox={mailbox}
												isSelected={selectedMailboxId === mailbox.mailboxId}
											/>
										))}
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
