import {
	Archive,
	Ban,
	BellOff,
	MailX,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Star,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";

/* ------------------------------------------------------------------ */
/* The fourth pane: mail intelligence. Driven by real backend signals */
/* (Address engagement counters, DKIM-mismatch category heuristics,   */
/* semantic search) with reserved slots for local-LLM and Bedrock     */
/* features. Silent when there is nothing to say; loudest element on  */
/* the screen when authenticity fails.                                */
/* ------------------------------------------------------------------ */

export type SenderTrustLevel = "unknown" | "wellknown" | "vip";

export interface SenderIntel {
	name: string;
	email: string;
	trust: SenderTrustLevel;
	/** Human label, e.g. "Jan 2025" or "today". */
	firstSeenLabel: string;
	inboundCount: number;
	replyCount: number;
}

export interface AuthenticityIntel {
	verdict: "aligned" | "mismatch";
	fromDomain: string;
	/** DKIM signing domain (d=), when known. */
	dkimDomain?: string;
	/** Brand the display name claims, when it differs from the mailbox. */
	claimedBrand?: string;
	/** Plain-language verdict shown to the user. */
	summary: string;
	/** Count of semantically similar messages (the campaign, not the instance). */
	similarCount?: number;
}

export type MatchedChunk =
	| "sender"
	| "recipient"
	| "subject"
	| "attachment"
	| "body"
	| "entities";

export interface SimilarMessageIntel {
	id: string;
	fromName: string;
	subject: string;
	timeLabel: string;
	matched: MatchedChunk;
}

export interface SenderFlagsIntel {
	vip?: boolean;
	muted?: boolean;
	blocked?: boolean;
	unsubscribed?: boolean;
	autoArchive?: boolean;
}

export interface IntelligenceData {
	sender: SenderIntel;
	authenticity: AuthenticityIntel;
	category: { value: string; overridden?: boolean };
	flags?: SenderFlagsIntel;
	similar: SimilarMessageIntel[];
}

export interface IntelligencePanelProps {
	data: IntelligenceData;
	onClose?: () => void;
	onShowSimilar?: () => void;
	/** Layout overrides (e.g. when hosted inside a resizable panel). */
	className?: string;
}

const trustLabel: Record<
	SenderTrustLevel,
	{ label: string; tone: "neutral" | "positive" | "accent" }
> = {
	unknown: { label: "Unknown sender", tone: "neutral" },
	wellknown: { label: "Known sender", tone: "positive" },
	vip: { label: "VIP", tone: "accent" },
};

function Section({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn("border-b border-line px-row-inset py-3", className)}
		>
			<h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</h3>
			<div className="mt-2">{children}</div>
		</section>
	);
}

function SenderCard({ sender }: { sender: SenderIntel }) {
	const trust = trustLabel[sender.trust];
	const engagement =
		sender.replyCount > 0
			? `${sender.inboundCount} received · you replied ${sender.replyCount}×`
			: `${sender.inboundCount} received · you've never replied`;
	return (
		<div>
			<div className="flex items-center gap-3">
				<Avatar name={sender.name} email={sender.email} size="md" />
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-fg">
						{sender.name}
					</div>
					<div className="truncate text-2xs text-fg-subtle">{sender.email}</div>
				</div>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<Badge tone={trust.tone} dot>
					{trust.label}
				</Badge>
			</div>
			<p className="mt-2 text-xs text-fg-muted">
				First seen {sender.firstSeenLabel} · {engagement}
			</p>
		</div>
	);
}

function Authenticity({
	auth,
	onShowSimilar,
}: {
	auth: AuthenticityIntel;
	onShowSimilar?: () => void;
}) {
	if (auth.verdict === "aligned") {
		return (
			<div className="flex items-start gap-2 text-xs text-fg-muted">
				<ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />
				<span>{auth.summary}</span>
			</div>
		);
	}
	return (
		<div className="rounded-md bg-danger-soft p-3">
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
				<div className="min-w-0">
					<p className="text-sm font-semibold text-danger">
						Likely impersonation
					</p>
					<p className="mt-1 text-xs leading-relaxed text-fg">{auth.summary}</p>
					{auth.dkimDomain && (
						<p className="mt-1 text-2xs text-fg-muted">
							DKIM signature:{" "}
							<code className="rounded bg-surface px-1 py-0.5">
								{auth.dkimDomain}
							</code>{" "}
							≠ claimed{" "}
							<code className="rounded bg-surface px-1 py-0.5">
								{auth.fromDomain}
							</code>
						</p>
					)}
				</div>
			</div>
			{auth.similarCount != null && auth.similarCount > 0 && (
				<Button
					variant="secondary"
					size="sm"
					className="mt-2 w-full border-danger/30 text-danger hover:bg-danger-soft"
					onClick={onShowSimilar}
				>
					{auth.similarCount} similar messages
				</Button>
			)}
		</div>
	);
}

function QuickAction({
	icon,
	label,
	active,
	danger,
}: {
	icon: ReactNode;
	label: string;
	active?: boolean;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors",
				active
					? "border-accent-2 bg-accent-2-soft text-accent-2"
					: "border-line text-fg-muted hover:border-line-strong hover:text-fg",
				danger && !active && "text-danger hover:bg-danger-soft",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

const matchTone: Record<MatchedChunk, string> = {
	sender: "matched: sender",
	recipient: "matched: recipient",
	subject: "matched: subject",
	attachment: "matched: attachment",
	body: "matched: body",
	entities: "matched: entities",
};

export function IntelligencePanel({
	data,
	onClose,
	onShowSimilar,
	className,
}: IntelligencePanelProps) {
	const { sender, authenticity, category, flags = {}, similar } = data;
	const suspicious = authenticity.verdict === "mismatch";

	return (
		<aside
			className={cn(
				"flex w-76 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface",
				className,
			)}
		>
			{/* pane-header datum: aligns with list + reading pane headers */}
			<header className="flex h-pane-header shrink-0 items-center justify-between border-b border-line px-row-inset">
				<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					Intelligence
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					onClick={onClose}
					aria-label="Collapse intelligence sidebar"
				/>
			</header>

			<Section label="Sender">
				<SenderCard sender={sender} />
			</Section>

			<Section label="Authenticity">
				<Authenticity auth={authenticity} onShowSimilar={onShowSimilar} />
			</Section>

			<Section label="Category">
				<div className="flex items-center gap-2">
					<Badge tone={suspicious ? "danger" : "neutral"}>
						{category.value}
					</Badge>
					{category.overridden && (
						<span className="text-2xs text-fg-subtle">your override</span>
					)}
					<button
						type="button"
						className="ml-auto text-2xs text-accent hover:underline"
					>
						reclassify
					</button>
				</div>
			</Section>

			<Section label="Quick actions">
				<div className="flex flex-wrap gap-1.5">
					<QuickAction
						icon={<Star className="size-3.5" />}
						label="VIP"
						active={flags.vip}
					/>
					<QuickAction
						icon={<BellOff className="size-3.5" />}
						label="Mute"
						active={flags.muted}
					/>
					<QuickAction
						icon={<Ban className="size-3.5" />}
						label="Block"
						active={flags.blocked}
						danger
					/>
					<QuickAction
						icon={<MailX className="size-3.5" />}
						label="Unsubscribe"
						active={flags.unsubscribed}
					/>
					<QuickAction
						icon={<Archive className="size-3.5" />}
						label="Auto-archive"
						active={flags.autoArchive}
					/>
				</div>
			</Section>

			{similar.length > 0 && (
				<Section label="Similar messages">
					<ul className="-mx-1 space-y-1">
						{similar.map((s) => (
							<li key={s.id}>
								<button
									type="button"
									className="w-full rounded-md px-1 py-1 text-left hover:bg-surface-sunken"
								>
									<div className="flex items-baseline justify-between gap-2">
										<span className="truncate text-xs font-medium text-fg">
											{s.fromName}
										</span>
										<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
											{s.timeLabel}
										</span>
									</div>
									<div className="truncate text-xs text-fg-muted">
										{s.subject}
									</div>
									<span className="mt-1 inline-block rounded-full bg-surface-sunken px-1.5 py-px text-2xs text-fg-subtle">
										{matchTone[s.matched]}
									</span>
								</button>
							</li>
						))}
					</ul>
				</Section>
			)}

			<Section label="Coming soon" className="border-b-0 opacity-70">
				<div className="space-y-2">
					<div className="flex items-start gap-2 rounded-md border border-dashed border-line p-2">
						<Sparkles className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
						<div>
							<div className="text-xs font-medium text-fg-muted">
								Suggested actions
							</div>
							<div className="text-2xs text-fg-subtle">
								"Create a filter for messages like this" — on-device model
							</div>
						</div>
					</div>
					<div className="flex items-start gap-2 rounded-md border border-dashed border-line p-2">
						<Sparkles className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
						<div>
							<div className="text-xs font-medium text-fg-muted">
								Thread summary
							</div>
							<div className="text-2xs text-fg-subtle">
								One-paragraph digest — Bedrock
							</div>
						</div>
					</div>
				</div>
			</Section>
		</aside>
	);
}
