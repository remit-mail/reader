import { ChevronLeft, CircleHelp, Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";

/* ------------------------------------------------------------------ */
/* Settings shell: shallow IA (Accounts / Senders & Rules /           */
/* Appearance / Advanced) with the same density discipline as mail.   */
/* Content is left-aligned against the nav (whitespace goes right).   */
/* The optional help rail mirrors the app IA: right rail = context    */
/* (intelligence in mail, tips & tricks in settings). All pane        */
/* headers sit on the shared pane-header datum.                       */
/*                                                                    */
/* Below desktop (lg) the rigid three columns collapse: the nav rail  */
/* becomes a drawer reached from a header menu button, the active     */
/* pane owns the full width, and the tips rail folds into a header    */
/* disclosure so it never crowds the pane the user came for.          */
/* ------------------------------------------------------------------ */

export interface SettingsNavItem {
	id: string;
	label: string;
	icon?: ReactNode;
}

export interface SettingsShellProps {
	items: SettingsNavItem[];
	activeId: string;
	title: string;
	description?: string;
	children: ReactNode;
	/** Contextual tips & tricks rail content; quiet, collapsible. */
	help?: ReactNode;
	/** Help rail visible on desktop (defaults to true when help is provided). */
	helpOpen?: boolean;
	/**
	 * Flush pages (e.g. the senders table) own the full content area and
	 * its scrolling; non-flush pages get a padded, left-aligned column.
	 */
	flush?: boolean;
	onSelect?: (id: string) => void;
	onToggleHelp?: () => void;
	/** Navigate back to the mail area (the "Back to mail" header button). */
	onBackToMail?: () => void;
}

export function SettingsShell({
	items,
	activeId,
	title,
	description,
	children,
	help,
	helpOpen = true,
	flush,
	onSelect,
	onToggleHelp,
	onBackToMail,
}: SettingsShellProps) {
	const [navOpen, setNavOpen] = useState(false);
	const [mobileHelpOpen, setMobileHelpOpen] = useState(false);
	const showHelp = Boolean(help) && helpOpen;

	const nav = (
		<>
			<div className="px-3 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				Settings
			</div>
			<nav className="flex-1 overflow-y-auto px-2 py-1">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => {
							onSelect?.(item.id);
							setNavOpen(false);
						}}
						className={cn(
							"flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors lg:min-h-0",
							item.id === activeId
								? "bg-accent-2-soft font-medium text-accent-2"
								: "text-fg-muted hover:bg-surface hover:text-fg",
						)}
					>
						{item.icon && (
							<span
								className={cn(
									"shrink-0",
									item.id === activeId ? "text-accent-2" : "text-fg-subtle",
								)}
							>
								{item.icon}
							</span>
						)}
						{item.label}
					</button>
				))}
			</nav>
		</>
	);

	return (
		<div className="flex h-dvh w-full overflow-hidden bg-canvas font-sans text-fg">
			{/* Desktop nav rail */}
			<aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface-sunken lg:flex">
				<div className="flex h-pane-header shrink-0 items-center border-b border-line px-2">
					<button
						type="button"
						onClick={onBackToMail}
						className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-fg-muted hover:bg-surface hover:text-fg"
					>
						<ChevronLeft className="size-4 text-fg-subtle" />
						Back to mail
					</button>
				</div>
				{nav}
			</aside>

			{/* Below-desktop nav drawer */}
			{navOpen && (
				<div className="fixed inset-0 z-50 flex lg:hidden">
					<button
						type="button"
						aria-label="Close menu"
						className="absolute inset-0 bg-canvas/60"
						onClick={() => setNavOpen(false)}
					/>
					<aside className="relative flex w-72 max-w-[85%] flex-col border-r border-line bg-surface-sunken">
						<div className="flex h-pane-header shrink-0 items-center justify-between border-b border-line px-2">
							<button
								type="button"
								onClick={() => {
									onBackToMail?.();
									setNavOpen(false);
								}}
								className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-fg-muted hover:bg-surface hover:text-fg"
							>
								<ChevronLeft className="size-4 text-fg-subtle" />
								Back to mail
							</button>
							<Button
								variant="ghost"
								size="sm"
								icon={<X className="size-4" />}
								onClick={() => setNavOpen(false)}
								aria-label="Close menu"
							/>
						</div>
						{nav}
					</aside>
				</div>
			)}

			<main className="flex min-w-0 flex-1 flex-col">
				{/* pane-header datum: title row, hairline at the shared y */}
				<header className="flex h-pane-header shrink-0 items-center gap-3 border-b border-line px-3 lg:px-5">
					<Button
						variant="ghost"
						size="sm"
						icon={<Menu className="size-4" />}
						className="lg:hidden"
						onClick={() => setNavOpen(true)}
						aria-label="Open settings menu"
					/>
					<h1 className="text-md font-semibold text-fg">{title}</h1>
					{description && (
						<p className="hidden min-w-0 truncate text-xs text-fg-subtle lg:block">
							{description}
						</p>
					)}
					{help && (
						<Button
							variant="ghost"
							size="sm"
							icon={<CircleHelp className="size-4" />}
							className="ml-auto lg:hidden"
							onClick={() => setMobileHelpOpen((v) => !v)}
							aria-label="Tips"
							aria-expanded={mobileHelpOpen}
						/>
					)}
					{help && !showHelp && (
						<Button
							variant="ghost"
							size="sm"
							icon={<CircleHelp className="size-4" />}
							className="hidden ml-auto lg:inline-flex"
							onClick={onToggleHelp}
							aria-label="Show tips"
						/>
					)}
				</header>

				{/* Below-desktop tips disclosure */}
				{help && mobileHelpOpen && (
					<div className="border-b border-line bg-surface-sunken px-row-inset py-3 text-xs leading-relaxed text-fg-muted lg:hidden">
						{help}
					</div>
				)}

				{flush ? (
					<div className="flex min-h-0 flex-1 flex-col">{children}</div>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto">
						{/* left-aligned content column; whitespace goes right */}
						<div className="max-w-2xl px-3 py-5 lg:px-5">
							<div className="space-y-5">{children}</div>
						</div>
					</div>
				)}
			</main>

			{showHelp && (
				<aside className="hidden w-64 shrink-0 flex-col border-l border-line bg-surface-sunken lg:flex">
					{/* pane-header datum */}
					<header className="flex h-pane-header shrink-0 items-center justify-between border-b border-line px-row-inset">
						<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
							Tips & tricks
						</span>
						<Button
							variant="ghost"
							size="sm"
							icon={<X className="size-3.5" />}
							onClick={onToggleHelp}
							aria-label="Collapse tips"
						/>
					</header>
					<div className="flex-1 overflow-y-auto px-row-inset py-3 text-xs leading-relaxed text-fg-muted">
						{help}
					</div>
				</aside>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* SenderFlagRow: one row in the Senders & Rules lists. The human-    */
/* readable face of AddressFlags. Dense, full-bleed hover, content    */
/* on the shared row inset.                                           */
/* ------------------------------------------------------------------ */

export interface SenderFlagRowProps {
	name: string;
	email: string;
	/** Engagement line, e.g. "34 received · you replied 12×". */
	meta: string;
	/** Flag provenance, e.g. "muted Mar 2026 — too chatty". */
	caption?: string;
	/** Danger ring (blocked senders). */
	danger?: boolean;
	trailing?: ReactNode;
}

export function SenderFlagRow({
	name,
	email,
	meta,
	caption,
	danger,
	trailing,
}: SenderFlagRowProps) {
	return (
		<div className="flex items-center gap-3 px-row-inset py-2 hover:bg-surface-sunken">
			<span className={cn(danger && "rounded-full ring-2 ring-danger/40")}>
				<Avatar name={name} email={email} size="sm" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-col gap-0 sm:flex-row sm:items-baseline sm:gap-2">
					<span className="truncate text-sm font-medium text-fg">{name}</span>
					<span className="truncate text-2xs text-fg-subtle">{email}</span>
				</div>
				<div className="text-xs text-fg-subtle">
					{meta}
					{caption && <span className="text-fg-muted"> · {caption}</span>}
				</div>
			</div>
			{trailing && <div className="shrink-0">{trailing}</div>}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* AccountHealthCard: account row with sync status + health chips.    */
/* ------------------------------------------------------------------ */

export interface AccountHealthCardProps {
	label: string;
	email: string;
	connector: string;
	syncLabel: string;
	state: "healthy" | "error" | "muted";
	/** lastError summary when state = error. */
	errorDetail?: string;
	trailing?: ReactNode;
}

const stateBadge: Record<
	AccountHealthCardProps["state"],
	{ tone: "positive" | "danger" | "neutral"; label: string }
> = {
	healthy: { tone: "positive", label: "healthy" },
	error: { tone: "danger", label: "error" },
	muted: { tone: "neutral", label: "muted" },
};

export function AccountHealthCard({
	label,
	email,
	connector,
	syncLabel,
	state,
	errorDetail,
	trailing,
}: AccountHealthCardProps) {
	const badge = stateBadge[state];
	return (
		<div
			className={cn(
				"rounded-sm border border-line bg-surface",
				state === "muted" && "opacity-65",
			)}
		>
			<div className="flex flex-col gap-3 px-row-inset py-3 sm:flex-row sm:items-center">
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<Avatar name={label} email={email} size="md" />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate text-sm font-semibold text-fg">
								{label}
							</span>
							<Badge tone={badge.tone} dot>
								{badge.label}
							</Badge>
						</div>
						<div className="truncate text-xs text-fg-subtle">
							{email} · {connector} · {syncLabel}
						</div>
					</div>
				</div>
				{trailing && <div className="shrink-0">{trailing}</div>}
			</div>
			{errorDetail && (
				<div className="border-t border-line px-row-inset py-2">
					<code className="block rounded-xs bg-danger-soft px-2 py-1 text-2xs text-danger">
						{errorDetail}
					</code>
				</div>
			)}
		</div>
	);
}
