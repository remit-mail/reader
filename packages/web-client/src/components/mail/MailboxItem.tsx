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
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

interface MailboxItemProps {
	mailbox: RemitImapMailboxResponse;
	isSelected: boolean;
}

const getMailboxDisplayName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return parts[parts.length - 1] || fullPath;
};

const getMailboxIcon = (fullPath: string): LucideIcon => {
	const name = fullPath.toLowerCase();
	if (name.includes("inbox")) return Inbox;
	if (name.includes("sent")) return Send;
	if (name.includes("draft")) return File;
	if (name.includes("trash") || name.includes("deleted")) return Trash2;
	if (name.includes("spam") || name.includes("junk")) return AlertTriangle;
	if (name.includes("archive")) return Archive;
	if (name.includes("starred") || name.includes("flagged")) return Star;
	if (name.includes("all")) return Mail;
	return Folder;
};

export const MailboxItem = ({ mailbox, isSelected }: MailboxItemProps) => {
	const displayName = getMailboxDisplayName(mailbox.fullPath);
	const Icon = getMailboxIcon(mailbox.fullPath);
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
		>
			<Icon className="size-4 shrink-0" />
			<span className="flex-1 truncate">{displayName}</span>
			{mailbox.unseenCount > 0 && <Badge count={mailbox.unseenCount} />}
		</Link>
	);
};
