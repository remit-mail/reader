import {
	BellOff,
	MailCheck,
	MailX,
	ShieldAlert,
	ShieldCheck,
	ShieldQuestion,
	ShieldX,
	Sparkles,
	Star,
	X,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn.js";
import {
	SEMANTIC_OFF_BUYS,
	SEMANTIC_OFF_COMMAND,
	SEMANTIC_OFF_TITLE,
} from "../lib/semantic-off.js";
import { categoryTone, type ThreadCategory } from "./app-shell-types.js";
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
	/**
	 * Engagement counters. Optional: when the API does not expose them, omit
	 * both and the engagement clause is suppressed rather than rendering a
	 * misleading "0 received · you've never replied" next to an earned trust
	 * badge. Render the clause only when `inboundCount` is provided.
	 */
	inboundCount?: number;
	replyCount?: number;
	/**
	 * True when the sender address is missing or unparseable (no valid domain).
	 * Drives a red "couldn't verify the address" badge instead of the quiet grey
	 * "Unknown sender", and forces the authenticity verdict to the red tier.
	 */
	addressUnverified?: boolean;
}

export interface AuthenticityIntel {
	/**
	 * Risk tier. `aligned` (green) — verified sender. `caution` (orange) — no
	 * verification signal available. `mismatch` (red) — impersonation or an
	 * unreadable sender address.
	 */
	verdict: "aligned" | "caution" | "mismatch";
	fromDomain: string;
	/** Signing domain the message was actually sent from, when known. */
	dkimDomain?: string;
	/** Brand the display name claims, when it differs from the mailbox. */
	claimedBrand?: string;
	/** Plain-language verdict shown to the user. */
	summary: string;
	/**
	 * True when the red tier is driven by an unreadable sender address rather
	 * than an impersonation mismatch — selects the headline and suppresses the
	 * domain-comparison line (there is no valid domain to show).
	 */
	addressUnreadable?: boolean;
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
	/** Mailbox the message lives in — the route param for opening it. */
	mailboxId: string;
	/** Conversation the message belongs to, which is what the reading pane opens. */
	threadId: string;
	fromName: string;
	subject: string;
	timeLabel: string;
	matched: MatchedChunk;
}

/**
 * Renders a similar-message row as a real anchor so middle-click /
 * open-in-new-tab / deep-linking / screen-reader link semantics all work. The
 * web-client passes a router `<Link>` builder; when omitted the row falls back
 * to a non-navigating element that preserves the visual (static stories).
 */
export interface SimilarMessageLinkProps {
	mailboxId: string;
	threadId: string;
	messageId: string;
	className: string;
	ariaLabel?: string;
	children: ReactNode;
}

export type SimilarMessageLinkComponent = (
	props: SimilarMessageLinkProps,
) => ReactElement;

export interface SenderFlagsIntel {
	vip?: boolean;
	muted?: boolean;
	/**
	 * True once the sender is blocked — via a spam report on some message from
	 * them, or a manual block in Settings → Senders, which is the only durable
	 * manage-and-undo surface for it now that this panel has no `Block` action
	 * of its own. Not used to decide the quick-actions pair below: it's a
	 * sender-wide flag, and a manual block with no report on THIS message would
	 * make "You reported this sender" false (issue #648 review). The pair and
	 * that line key off `actions.onNotSpam`/`onReportSpam` instead, which the
	 * host derives from this specific message's `Message.spamReport`.
	 */
	blocked?: boolean;
	unsubscribed?: boolean;
}

export interface IntelligenceData {
	sender: SenderIntel;
	authenticity: AuthenticityIntel;
	category: { value: ThreadCategory; overridden?: boolean };
	flags?: SenderFlagsIntel;
	similar: SimilarMessageIntel[];
}

export interface IntelligenceQuickActions {
	onToggleVip?: () => void;
	onToggleMute?: () => void;
	onToggleUnsubscribe?: () => void;
	onReclassify?: () => void;
	/**
	 * "Not spam": undo a spam report — clears the sender block and moves the
	 * message back where it came from (issue #648). Wired only when the
	 * message currently carries a spam report.
	 */
	onNotSpam?: () => void;
	/**
	 * "Report spam": move the message into Junk and block the sender (the
	 * inverse of "Not spam", issue #648). Wired only when the message has not
	 * been reported yet. Replaces the former separate `Block` and `Mark spam`
	 * actions with one contextual control.
	 */
	onReportSpam?: () => void;
}

/**
 * State of the similar-messages section. The host computes these from the
 * semantic-search query so the panel can show a skeleton while in flight and
 * "similarity search unavailable" on failure (the rest of the sidebar still
 * renders). Defaults to "ready" when omitted.
 *
 * "off" is not a failure and not a slow query: this instance stores no message
 * vectors, and it says so with the command that changes it. Without it the
 * section renders nothing at all, which reads as a sender nothing resembles.
 */
export type SimilarState = "loading" | "error" | "off" | "ready";

export interface IntelligencePanelProps {
	data: IntelligenceData;
	onClose?: () => void;
	onShowSimilar?: () => void;
	/** Quick-action callbacks. When omitted the buttons are visual-only. */
	actions?: IntelligenceQuickActions;
	/** Loading/error state for the similar-messages section. */
	similarState?: SimilarState;
	/**
	 * Render-prop that wraps each similar-message row in a real router anchor so
	 * it opens that email (deep-link / middle-click / link a11y). When omitted the
	 * rows render as static, non-navigating elements (stories / SSR previews).
	 */
	similarLinkComponent?: SimilarMessageLinkComponent;
	/** Layout overrides (e.g. when hosted inside a resizable panel). */
	className?: string;
	/**
	 * Suppress the panel's own close (X) button. Set when the panel is hosted
	 * inside a chrome that already provides a close affordance (e.g. the mobile
	 * Drawer header), so there is exactly one way back (#874).
	 */
	hideCloseButton?: boolean;
	/**
	 * True while a "Report spam" press is in flight. There is no optimistic
	 * update for this action (issue #648: the client can't predict whether a
	 * report against a message already in Junk is a no-op), so without this
	 * the button gives no visible response at all until the request lands — a
	 * dead button is the worst outcome. Swaps the label to "Reporting…" AND
	 * disables the button: the server dedupes message ids only within a
	 * single request, so a second press mid-flight fires a second, concurrent
	 * request rather than joining the first (issue #648 review — for "Not
	 * spam" this races the restore move and can surface a spurious
	 * "try again in a moment" for an undo that already succeeded).
	 */
	reportSpamPending?: boolean;
	/** True while a "Not spam" (undo) press is in flight. Same treatment as `reportSpamPending`. */
	notSpamPending?: boolean;
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
	// Engagement clause renders only when counters are present. When the API
	// does not expose inboundCount/replyCount we show first-seen alone rather
	// than a misleading "0 received · you've never replied".
	const engagement =
		sender.inboundCount == null
			? null
			: (sender.replyCount ?? 0) > 0
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
				{sender.addressUnverified ? (
					<Badge tone="danger" dot>
						Address couldn't be verified
					</Badge>
				) : (
					<Badge tone={trust.tone} dot>
						{trust.label}
					</Badge>
				)}
			</div>
			<p className="mt-2 text-xs text-fg-muted">
				First seen {sender.firstSeenLabel}
				{engagement ? ` · ${engagement}` : ""}
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
	if (auth.verdict === "caution") {
		return (
			<div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-warning">
				<ShieldQuestion className="mt-0.5 size-4 shrink-0" />
				<p className="text-xs leading-relaxed">{auth.summary}</p>
			</div>
		);
	}
	const headline = auth.addressUnreadable
		? "This sender can't be verified"
		: "This message may be impersonating someone";
	return (
		<div className="rounded-md bg-danger-soft p-3">
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
				<div className="min-w-0">
					<p className="text-sm font-semibold text-danger">{headline}</p>
					<p className="mt-1 text-xs leading-relaxed text-fg">{auth.summary}</p>
					{!auth.addressUnreadable && auth.dkimDomain && (
						<p className="mt-1 text-2xs text-fg-muted">
							Sent from{" "}
							<code className="rounded bg-surface px-1 py-0.5">
								{auth.dkimDomain}
							</code>
							, claims to be{" "}
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
	onClick,
	pending,
}: {
	icon: ReactNode;
	label: string;
	active?: boolean;
	danger?: boolean;
	onClick?: () => void;
	/** Disable the button without hiding it — a request for this action is already in flight. */
	pending?: boolean;
}) {
	// No handler means the action cannot be serviced yet (the sender's address
	// record has not resolved). Render it visibly unavailable rather than as a
	// live button that swallows the click. `pending` disables it for the same
	// reason once a press is in flight.
	const disabled = onClick === undefined || pending === true;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors",
				active
					? "border-accent-2 bg-accent-2-soft text-accent-2"
					: "border-line text-fg-muted hover:border-line-strong hover:text-fg",
				danger && !active && "text-danger hover:bg-danger-soft",
				disabled && "cursor-not-allowed opacity-50 hover:border-line",
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
	actions,
	similarState = "ready",
	similarLinkComponent,
	className,
	hideCloseButton = false,
	reportSpamPending = false,
	notSpamPending = false,
}: IntelligencePanelProps) {
	const { sender, authenticity, category, flags = {}, similar } = data;

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
				{!hideCloseButton && (
					<Button
						variant="ghost"
						size="sm"
						icon={<X className="size-3.5" />}
						onClick={onClose}
						aria-label="Collapse intelligence sidebar"
					/>
				)}
			</header>

			<Section label="Sender">
				<SenderCard sender={sender} />
			</Section>

			<Section label="Authenticity">
				<Authenticity auth={authenticity} onShowSimilar={onShowSimilar} />
			</Section>

			<Section label="Category">
				<div className="flex items-center gap-2">
					<Badge tone={categoryTone[category.value]}>{category.value}</Badge>
					{category.overridden && (
						<span className="text-2xs text-fg-subtle">your override</span>
					)}
					<button
						type="button"
						className={cn(
							"ml-auto text-2xs text-accent hover:underline",
							!actions?.onReclassify &&
								"cursor-not-allowed opacity-50 hover:no-underline",
						)}
						disabled={!actions?.onReclassify}
						onClick={actions?.onReclassify}
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
						onClick={actions?.onToggleVip}
					/>
					<QuickAction
						icon={<BellOff className="size-3.5" />}
						label="Mute"
						active={flags.muted}
						onClick={actions?.onToggleMute}
					/>
					{actions?.onNotSpam && (
						<QuickAction
							icon={<MailCheck className="size-3.5" />}
							label={notSpamPending ? "Undoing…" : "Not spam"}
							active
							onClick={actions.onNotSpam}
							pending={notSpamPending}
						/>
					)}
					{actions?.onReportSpam && (
						<QuickAction
							icon={<ShieldX className="size-3.5" />}
							label={reportSpamPending ? "Reporting…" : "Report spam"}
							danger
							onClick={actions.onReportSpam}
							pending={reportSpamPending}
						/>
					)}
					<QuickAction
						icon={<MailX className="size-3.5" />}
						label="Unsubscribe"
						active={flags.unsubscribed}
						onClick={actions?.onToggleUnsubscribe}
					/>
				</div>
				{actions?.onNotSpam && (
					<p className="mt-1.5 text-2xs text-fg-subtle">
						You reported this message as spam
					</p>
				)}
			</Section>

			{(similarState !== "ready" || similar.length > 0) && (
				<Section label="Similar messages">
					{similarState === "loading" ? (
						<div className="animate-pulse space-y-2">
							{Array.from({ length: 3 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: list is static, no stable id
								<div key={i} className="space-y-1">
									<div className="h-3 w-3/4 rounded bg-surface-sunken" />
									<div className="h-2.5 w-1/2 rounded bg-surface-sunken" />
								</div>
							))}
						</div>
					) : similarState === "error" ? (
						<p className="text-xs text-fg-subtle">
							Similarity search unavailable
						</p>
					) : similarState === "off" ? (
						<div className="space-y-1.5 text-xs text-fg-subtle">
							<p className="text-fg-muted">{SEMANTIC_OFF_TITLE}</p>
							<p>{SEMANTIC_OFF_BUYS}</p>
							<p>
								Run{" "}
								<code className="rounded bg-surface-sunken px-1 py-px text-2xs text-fg-muted">
									{SEMANTIC_OFF_COMMAND}
								</code>{" "}
								on the server.
							</p>
						</div>
					) : (
						<ul className="-mx-1 space-y-1">
							{similar.map((s) => {
								const rowClass =
									"block w-full rounded-md px-1 py-1 text-left hover:bg-surface-sunken";
								const ariaLabel = `Open message from ${s.fromName || "unknown sender"}: ${s.subject}`;
								const inner = (
									<>
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
									</>
								);
								return (
									<li key={s.id}>
										{similarLinkComponent ? (
											similarLinkComponent({
												mailboxId: s.mailboxId,
												threadId: s.threadId,
												messageId: s.id,
												className: rowClass,
												ariaLabel,
												children: inner,
											})
										) : (
											<div className={rowClass}>{inner}</div>
										)}
									</li>
								);
							})}
						</ul>
					)}
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
