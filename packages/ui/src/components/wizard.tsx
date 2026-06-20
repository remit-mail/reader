import { Check } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "../lib/cn.js";
import { Badge, type BadgeProps } from "./badge.js";
import { Card } from "./card.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";
import { SecuritySelect, type ServerSecurity } from "./security-select.js";

/* ------------------------------------------------------------------ */
/* WizardShell: centered card + step rail used by onboarding and the  */
/* settings add-account flow. Any flow with >1-2 decisions is a       */
/* wizard — this is the one implementation.                           */
/* ------------------------------------------------------------------ */

export interface WizardShellProps {
	/** Ordered step labels for the rail. */
	steps: string[];
	/** Zero-based index of the active step. */
	activeStep: number;
	title: string;
	subtitle?: string;
	children: ReactNode;
	/** Footer slot: back/continue buttons, hints. */
	footer?: ReactNode;
	/** Hide the rail (welcome screen). */
	hideSteps?: boolean;
}

function StepRail({
	steps,
	activeStep,
}: Pick<WizardShellProps, "steps" | "activeStep">) {
	return (
		<ol className="flex items-center gap-1">
			{steps.map((label, i) => {
				const done = i < activeStep;
				const active = i === activeStep;
				return (
					<li key={label} className="flex items-center gap-1">
						{i > 0 && <span className="h-px w-5 bg-line" aria-hidden />}
						<span className="flex items-center gap-1.5">
							<span
								className={cn(
									"flex size-5 items-center justify-center rounded-full text-2xs font-semibold tabular-nums",
									done && "bg-accent text-accent-fg",
									active && "bg-accent-soft text-accent ring-1 ring-accent",
									!done && !active && "bg-surface-sunken text-fg-subtle",
								)}
							>
								{done ? <Check className="size-3" /> : i + 1}
							</span>
							<span
								className={cn(
									"hidden text-2xs sm:inline",
									active ? "font-medium text-fg" : "text-fg-subtle",
								)}
							>
								{label}
							</span>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

export function WizardShell({
	steps,
	activeStep,
	title,
	subtitle,
	children,
	footer,
	hideSteps,
}: WizardShellProps) {
	return (
		// First-run is a focal moment: the wizard column is horizontally
		// centered with its top edge anchored ~30% down the viewport
		// (optical center) on larger screens. On phone the top padding is
		// minimal so taller steps (connector picker, servers) don't push the
		// CTA bar below the fold — the shell scrolls if content overflows.
		<div className="flex min-h-dvh w-full flex-col items-center overflow-y-auto bg-canvas px-8 pb-8 pt-8 font-sans text-fg sm:pt-[30vh]">
			{!hideSteps && (
				<div className="mb-5 w-full max-w-xl">
					<StepRail steps={steps} activeStep={activeStep} />
				</div>
			)}
			<Card raised className="w-full max-w-xl">
				<div className="px-5 pt-5">
					<h1 className="text-xl font-semibold text-fg">{title}</h1>
					{subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
				</div>
				<div className="px-5 py-5">{children}</div>
				{footer && (
					<div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
						{footer}
					</div>
				)}
			</Card>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* ConnectorTile: connector picker option (IMAP now, OAuth later).    */
/* ------------------------------------------------------------------ */

export interface ConnectorTileProps {
	name: string;
	description: string;
	icon: ReactNode;
	/** "coming soon" connectors render muted with a badge — still pressable. */
	comingSoon?: boolean;
	selected?: boolean;
	onSelect?: () => void;
}

// Per the never-disable tenet a "soon" tile stays pressable: with no handler it
// surfaces a one-line explainer instead of going dead.
const COMING_SOON_HINT = "Coming soon — use IMAP for now.";

export function ConnectorTile({
	name,
	description,
	icon,
	comingSoon,
	selected,
	onSelect,
}: ConnectorTileProps) {
	const [showHint, setShowHint] = useState(false);

	const handleClick = () => {
		if (onSelect) {
			onSelect();
			return;
		}
		if (comingSoon) setShowHint(true);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<button
				type="button"
				onClick={handleClick}
				aria-disabled={comingSoon || undefined}
				className={cn(
					"flex flex-col items-start gap-2 rounded-sm border p-3 text-left transition-colors",
					selected
						? "border-accent-2 bg-accent-2-soft"
						: "border-line bg-surface hover:border-line-strong",
					comingSoon && "opacity-55",
				)}
			>
				<span className={cn("text-fg-muted", selected && "text-accent-2")}>
					{icon}
				</span>
				<span className="flex items-center gap-2">
					<span className="text-sm font-semibold text-fg">{name}</span>
					{comingSoon && (
						<span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-subtle">
							soon
						</span>
					)}
				</span>
				<span className="text-xs text-fg-subtle">{description}</span>
			</button>
			{showHint && (
				<p className="text-2xs text-fg-subtle">{COMING_SOON_HINT}</p>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Server settings field group: host / port / security for one        */
/* protocol (IMAP or SMTP). Responsive — stacks to one column on phone */
/* so the Security select is never clipped — and shared by the         */
/* onboarding flow and the settings add-account form.                  */
/* ------------------------------------------------------------------ */

export interface ServerFieldsProps {
	/** "IMAP — incoming" / "SMTP — outgoing". */
	legend: string;
	/** Optional badge after the legend ("detected" / "preset"). */
	badge?: { label: string; tone: BadgeProps["tone"] };
	host: string;
	port: string;
	security: ServerSecurity;
	/** Locked presets render read-only and omit change handlers. */
	readOnly?: boolean;
	onHostChange?: (value: string) => void;
	onPortChange?: (value: string) => void;
	onSecurityChange?: (value: ServerSecurity) => void;
	hostPlaceholder?: string;
	portPlaceholder?: string;
}

export function ServerFields({
	legend,
	badge,
	host,
	port,
	security,
	readOnly,
	onHostChange,
	onPortChange,
	onSecurityChange,
	hostPlaceholder,
	portPlaceholder,
}: ServerFieldsProps) {
	const hostId = useId();
	const portId = useId();
	const securityId = useId();
	return (
		<fieldset>
			<legend className="flex items-center gap-2 text-sm font-semibold text-fg">
				{legend}
				{badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
			</legend>
			<div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_8rem] sm:gap-2">
				<div>
					<FieldLabel htmlFor={hostId}>Host</FieldLabel>
					{onHostChange ? (
						<Input
							id={hostId}
							readOnly={readOnly}
							value={host}
							onChange={(e) => onHostChange(e.target.value)}
							placeholder={hostPlaceholder}
						/>
					) : (
						<Input
							id={hostId}
							readOnly={readOnly}
							defaultValue={host}
							placeholder={hostPlaceholder}
						/>
					)}
				</div>
				<div>
					<FieldLabel htmlFor={portId}>Port</FieldLabel>
					{onPortChange ? (
						<Input
							id={portId}
							readOnly={readOnly}
							value={port}
							onChange={(e) => onPortChange(e.target.value)}
							placeholder={portPlaceholder}
						/>
					) : (
						<Input
							id={portId}
							readOnly={readOnly}
							defaultValue={port}
							placeholder={portPlaceholder}
						/>
					)}
				</div>
				<div>
					<FieldLabel htmlFor={securityId}>Security</FieldLabel>
					{onSecurityChange ? (
						<SecuritySelect
							id={securityId}
							value={security}
							onValueChange={onSecurityChange}
						/>
					) : (
						<SecuritySelect id={securityId} defaultValue={security} />
					)}
				</div>
			</div>
		</fieldset>
	);
}

/* ------------------------------------------------------------------ */
/* CheckRow: live status line for connection tests & sync checks.     */
/* ------------------------------------------------------------------ */

export interface CheckRowProps {
	label: string;
	detail?: string;
	state: "pending" | "running" | "ok" | "failed";
}

export function CheckRow({ label, detail, state }: CheckRowProps) {
	return (
		<div className="flex items-start gap-3 py-2">
			<span
				className={cn(
					"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs",
					state === "ok" && "bg-positive text-accent-fg",
					state === "failed" && "bg-danger text-accent-fg",
					state === "running" && "border border-accent text-accent",
					state === "pending" && "border border-line text-fg-subtle",
				)}
			>
				{state === "ok" && <Check className="size-3" />}
				{state === "failed" && "!"}
				{state === "running" && (
					<span className="size-2 animate-pulse rounded-full bg-accent" />
				)}
			</span>
			<div className="min-w-0">
				<div
					className={cn(
						"text-sm",
						state === "failed" ? "font-medium text-danger" : "text-fg",
					)}
				>
					{label}
				</div>
				{detail && (
					<div className="mt-0.5 text-xs text-fg-subtle">{detail}</div>
				)}
			</div>
		</div>
	);
}
