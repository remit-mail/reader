import { threadOperationsListThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangle,
	Archive,
	File,
	Folder,
	Inbox,
	Mail,
	Send,
	Star,
	Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import {
	getMailboxDisplayLabel,
	getMailboxKind,
	shouldShowUnreadBadge,
} from "@/lib/mailbox-order";
import { cn } from "@/lib/utils";

interface MailboxItemProps {
	mailbox: RemitImapMailboxResponse;
	isSelected: boolean;
}

const ICON_BY_KIND: Record<string, LucideIcon> = {
	inbox: Inbox,
	sent: Send,
	drafts: File,
	trash: Trash2,
	junk: AlertTriangle,
	archive: Archive,
	flagged: Star,
	all: Mail,
};

const getMailboxIcon = (
	fullPath: string,
	specialUse: readonly string[] | undefined,
): LucideIcon => {
	const kind = getMailboxKind(fullPath, specialUse);
	if (kind && ICON_BY_KIND[kind]) return ICON_BY_KIND[kind];
	return Folder;
};

export const MailboxItem = ({ mailbox, isSelected }: MailboxItemProps) => {
	const { t } = useTranslation("mail", { useSuspense: false });
	const translator = (key: string, fallback: string): string =>
		t(key, { defaultValue: fallback });
	const displayName = getMailboxDisplayLabel(
		mailbox.fullPath,
		mailbox.specialUse,
		translator,
	);
	const Icon = getMailboxIcon(mailbox.fullPath, mailbox.specialUse);
	const showBadge =
		shouldShowUnreadBadge(mailbox.fullPath, mailbox.specialUse) &&
		mailbox.unseenCount > 0;
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const handleClick = (e: React.MouseEvent) => {
		// Invalidate the threads query to force a fresh fetch
		const queryKey = threadOperationsListThreadsQueryKey({
			path: { mailboxId: mailbox.mailboxId },
			query: { order: "desc" },
		});
		queryClient.invalidateQueries({ queryKey });

		// If already on this mailbox, prevent default Link navigation and manually navigate
		// This ensures the query refetches even when clicking on the current mailbox
		if (isSelected) {
			e.preventDefault();
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId: mailbox.mailboxId },
			});
		}
	};

	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId: mailbox.mailboxId }}
			onClick={handleClick}
			className={cn(
				"flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors",
				"hover:bg-accent",
				isSelected && "bg-accent font-medium",
			)}
			aria-label={displayName}
			title={mailbox.fullPath}
		>
			<Icon className="size-4 shrink-0" />
			<span className="flex-1 truncate">{displayName}</span>
			{showBadge && (
				<Badge count={mailbox.unseenCount} totalCount={mailbox.messageCount} />
			)}
		</Link>
	);
};
