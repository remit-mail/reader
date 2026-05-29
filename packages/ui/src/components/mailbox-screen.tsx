import type { MailboxResponse } from "@remit/api-openapi-types";
import {
	Archive,
	ChevronLeft,
	Flag,
	Forward,
	Inbox,
	MoreHorizontal,
	Pencil,
	Reply,
	ReplyAll,
	Search,
	Send,
	Settings,
	Star,
	Trash2,
} from "lucide-react";
import type { MessageView } from "../fixtures/messages.js";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { ListItem } from "./list-item.js";

export interface MailboxScreenProps {
	accountEmail: string;
	mailboxes: MailboxResponse[];
	messages: MessageView[];
	selectedMailboxId: string;
	selectedMessageId?: string;
	onSelectMailbox?: (id: string) => void;
	onSelectMessage?: (id: string) => void;
}

const folderIcon: Record<string, typeof Inbox> = {
	INBOX: Inbox,
	Flagged: Star,
	Sent: Send,
	Drafts: Pencil,
	Archive: Archive,
	Junk: Flag,
	Trash: Trash2,
};

function folderLabel(mb: MailboxResponse): string {
	return mb.fullPath === "INBOX" ? "Inbox" : mb.fullPath;
}

function fromOf(m: MessageView) {
	const f = m.envelope.from[0];
	return {
		name: f?.displayName ?? f?.normalizedEmail ?? "Unknown",
		email: f?.normalizedEmail ?? "",
	};
}

function isUnread(m: MessageView): boolean {
	return !m.flags.includes("\\Seen");
}

function isFlagged(m: MessageView): boolean {
	return m.flags.includes("\\Flagged");
}

function relTime(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000);
	const now = new Date(Date.UTC(2026, 4, 29, 9, 14));
	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) {
		return d.toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
	if (diffDays <= 6) return d.toLocaleDateString("en-GB", { weekday: "short" });
	return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const categoryTone: Record<
	string,
	"neutral" | "accent" | "positive" | "warning"
> = {
	personal: "accent",
	newsletter: "neutral",
	marketing: "neutral",
	automated: "neutral",
	transactional: "positive",
	social: "warning",
};

/* ------------------------------------------------------------------ */
/* Left: folder sidebar                                               */
/* ------------------------------------------------------------------ */
function Sidebar({
	accountEmail,
	mailboxes,
	selectedMailboxId,
	onSelectMailbox,
}: Pick<
	MailboxScreenProps,
	"accountEmail" | "mailboxes" | "selectedMailboxId" | "onSelectMailbox"
>) {
	return (
		<aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-sunken">
			<div className="flex items-center gap-2.5 px-4 py-3.5">
				<Avatar name={accountEmail} email={accountEmail} size="sm" />
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-fg">
						Alice Tan
					</div>
					<div className="truncate text-2xs text-fg-subtle">{accountEmail}</div>
				</div>
			</div>

			<div className="px-3 pb-2">
				<Button
					variant="primary"
					size="md"
					icon={<Pencil className="size-4" />}
					className="w-full"
				>
					Compose
				</Button>
			</div>

			<nav className="flex-1 overflow-y-auto px-2 py-1">
				{mailboxes.map((mb) => {
					const Icon = folderIcon[mb.fullPath] ?? Inbox;
					const active = mb.mailboxId === selectedMailboxId;
					return (
						<button
							key={mb.mailboxId}
							type="button"
							onClick={() => onSelectMailbox?.(mb.mailboxId)}
							className={cn(
								"flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
								active
									? "bg-accent-soft font-medium text-accent"
									: "text-fg-muted hover:bg-surface hover:text-fg",
							)}
						>
							<Icon
								className={cn(
									"size-4 shrink-0",
									active ? "text-accent" : "text-fg-subtle",
								)}
							/>
							<span className="flex-1 truncate">{folderLabel(mb)}</span>
							{mb.unseenCount > 0 && (
								<span
									className={cn(
										"text-2xs tabular-nums",
										active ? "text-accent" : "text-fg-subtle",
									)}
								>
									{mb.unseenCount}
								</span>
							)}
						</button>
					);
				})}
			</nav>

			<div className="border-t border-line px-2 py-2">
				<button
					type="button"
					className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface hover:text-fg"
				>
					<Settings className="size-4 text-fg-subtle" />
					Settings
				</button>
			</div>
		</aside>
	);
}

/* ------------------------------------------------------------------ */
/* Middle: message list                                               */
/* ------------------------------------------------------------------ */
function MessageList({
	mailbox,
	messages,
	selectedMessageId,
	onSelectMessage,
}: {
	mailbox?: MailboxResponse;
	messages: MessageView[];
	selectedMessageId?: string;
	onSelectMessage?: (id: string) => void;
}) {
	return (
		<section className="flex w-96 shrink-0 flex-col border-r border-line bg-surface">
			<header className="flex flex-col gap-3 border-b border-line px-4 pt-3.5 pb-3">
				<div className="flex items-center justify-between">
					<h1 className="text-lg font-semibold text-fg">
						{mailbox ? folderLabel(mailbox) : "Mail"}
					</h1>
					<span className="text-2xs text-fg-subtle">
						{mailbox?.unseenCount
							? `${mailbox.unseenCount} unread`
							: "All read"}
					</span>
				</div>
				<Input icon={<Search className="size-4" />} placeholder="Search mail" />
			</header>

			<div className="flex-1 overflow-y-auto divide-y divide-line">
				{messages.map((m) => {
					const from = fromOf(m);
					const unread = isUnread(m);
					const active = m.message.messageId === selectedMessageId;
					const category = m.envelope.category;
					return (
						<ListItem
							key={m.message.messageId}
							active={active}
							unread={unread}
							onClick={() => onSelectMessage?.(m.message.messageId)}
							leading={<Avatar name={from.name} email={from.email} size="md" />}
						>
							<div className="flex items-baseline justify-between gap-2">
								<span
									className={cn(
										"truncate text-sm",
										unread
											? "font-semibold text-fg"
											: "font-medium text-fg-muted",
									)}
								>
									{from.name}
								</span>
								<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
									{relTime(m.envelope.date)}
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								<span
									className={cn(
										"truncate text-sm",
										unread ? "text-fg" : "text-fg-muted",
									)}
								>
									{m.envelope.subject}
								</span>
								{isFlagged(m) && (
									<Star className="size-3 shrink-0 fill-warning text-warning" />
								)}
							</div>
							<p className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
								{m.preview}
							</p>
							{category && category !== "personal" && (
								<div className="mt-1.5">
									<Badge tone={categoryTone[category] ?? "neutral"}>
										{category}
									</Badge>
								</div>
							)}
						</ListItem>
					);
				})}
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Right: reading pane                                                */
/* ------------------------------------------------------------------ */
function ReadingPane({
	message,
	onBack,
}: {
	message?: MessageView;
	onBack?: () => void;
}) {
	if (!message) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center bg-canvas text-center">
				<Inbox className="size-10 text-fg-subtle" />
				<p className="mt-3 text-sm text-fg-muted">Select a message to read</p>
				<p className="text-2xs text-fg-subtle">Nothing selected</p>
			</div>
		);
	}

	const from = fromOf(message);
	const to = message.envelope.to
		.map((a) => a.displayName ?? a.normalizedEmail)
		.join(", ");
	const date = new Date(message.envelope.date * 1000).toLocaleString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

	return (
		<article className="flex flex-1 flex-col bg-canvas">
			<header className="flex items-center gap-1 border-b border-line bg-surface px-3 py-2">
				<Button
					variant="ghost"
					size="sm"
					icon={<ChevronLeft className="size-4" />}
					onClick={onBack}
				>
					<span className="sr-only">Back</span>
				</Button>
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					icon={<Archive className="size-4" />}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon={<Trash2 className="size-4" />}
				/>
				<Button variant="ghost" size="sm" icon={<Star className="size-4" />} />
				<Button
					variant="ghost"
					size="sm"
					icon={<MoreHorizontal className="size-4" />}
				/>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-2xl px-8 py-7">
					<h2 className="text-xl font-semibold leading-snug text-fg">
						{message.envelope.subject}
					</h2>

					<div className="mt-4 flex items-start gap-3">
						<Avatar name={from.name} email={from.email} size="lg" />
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-sm font-semibold text-fg">
									{from.name}
								</span>
								<span className="text-2xs text-fg-subtle">{date}</span>
							</div>
							<div className="text-xs text-fg-subtle">{from.email}</div>
							<div className="text-xs text-fg-subtle">to {to}</div>
						</div>
					</div>

					{message.envelope.senderTrust === "wellknown" && (
						<div className="mt-3">
							<Badge tone="positive" dot>
								Known sender
							</Badge>
						</div>
					)}

					<div
						className="prose-email mt-6 text-md leading-relaxed text-fg [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: fixture HTML only, no user input in the workbench
						dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
					/>

					<div className="mt-8 flex gap-2 border-t border-line pt-5">
						<Button
							variant="secondary"
							size="md"
							icon={<Reply className="size-4" />}
						>
							Reply
						</Button>
						<Button
							variant="secondary"
							size="md"
							icon={<ReplyAll className="size-4" />}
						>
							Reply all
						</Button>
						<Button
							variant="secondary"
							size="md"
							icon={<Forward className="size-4" />}
						>
							Forward
						</Button>
					</div>
				</div>
			</div>
		</article>
	);
}

/* ------------------------------------------------------------------ */
/* Composite three-pane screen                                        */
/* ------------------------------------------------------------------ */
export function MailboxScreen({
	accountEmail,
	mailboxes,
	messages,
	selectedMailboxId,
	selectedMessageId,
	onSelectMailbox,
	onSelectMessage,
}: MailboxScreenProps) {
	const mailbox = mailboxes.find((m) => m.mailboxId === selectedMailboxId);
	const selected = messages.find(
		(m) => m.message.messageId === selectedMessageId,
	);

	return (
		<div className="flex h-dvh w-full overflow-hidden bg-canvas font-sans text-fg">
			<Sidebar
				accountEmail={accountEmail}
				mailboxes={mailboxes}
				selectedMailboxId={selectedMailboxId}
				onSelectMailbox={onSelectMailbox}
			/>
			<MessageList
				mailbox={mailbox}
				messages={messages}
				selectedMessageId={selectedMessageId}
				onSelectMessage={onSelectMessage}
			/>
			<ReadingPane message={selected} onBack={() => onSelectMessage?.("")} />
		</div>
	);
}
