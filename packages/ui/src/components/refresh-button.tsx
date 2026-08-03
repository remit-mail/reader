import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button, type ButtonProps } from "./button.js";

export type RefreshControlState = "idle" | "refreshing" | "success" | "error";

export interface RefreshButtonProps {
	state: RefreshControlState;
	onRefresh: () => void;
	/** What this refreshes, e.g. "Refresh inbox", "Refresh daily brief". Also the
	 * retry action's name while `state` is "error". */
	label: string;
	/** What failed and the likely fix, shown as the tooltip and appended to the
	 * accessible name. Required once `state` is "error" — a failure with
	 * nothing said is a dead button. */
	errorMessage?: string;
	/**
	 * Mail arrived since this was last acted on — the once-a-minute background
	 * poll's own signal, surfaced as a quiet dot rather than reloading anything.
	 * Only shown at rest; a refresh already in flight or just finished has
	 * nothing left to point at.
	 */
	hasUpdate?: boolean;
	size?: ButtonProps["size"];
	className?: string;
}

/**
 * The one refresh control, shared by the inbox header, the daily brief header
 * and the shell's global refresh — three call sites, one affordance. States:
 *
 * - idle: a plain refresh glyph, optionally carrying the "new mail" dot.
 * - refreshing: the same glyph spinning, disabled — never a second click
 *   stacked on the one in flight.
 * - success: a brief checkmark, the caller's cue that nothing was left
 *   unresolved (reverts to idle on its own after a beat).
 * - error: an alert glyph naming what failed, in the tooltip and the
 *   accessible name; clicking it retries the same action. A refresh that
 *   never answers must land here, not spin forever.
 */
export function RefreshButton({
	state,
	onRefresh,
	label,
	errorMessage,
	hasUpdate,
	size = "sm",
	className,
}: RefreshButtonProps) {
	const busy = state === "refreshing";
	const failed = state === "error";
	const succeeded = state === "success";

	const icon = failed ? (
		<AlertCircle className="size-4 text-danger" />
	) : succeeded ? (
		<CheckCircle className="size-4 text-positive" />
	) : (
		<RefreshCw className={cn("size-4", busy && "animate-spin")} />
	);

	const accessibleLabel = failed
		? `${label} — failed: ${errorMessage ?? "try again"}`
		: busy
			? `${label} — refreshing`
			: succeeded
				? `${label} — up to date`
				: hasUpdate
					? `${label} — new mail`
					: label;

	return (
		<div className="relative inline-flex">
			<Button
				variant="ghost"
				size={size}
				icon={icon}
				onClick={onRefresh}
				disabled={busy}
				aria-label={accessibleLabel}
				aria-busy={busy || undefined}
				title={failed ? errorMessage : label}
				className={className}
			/>
			{state === "idle" && hasUpdate && (
				<span
					aria-hidden="true"
					className="absolute right-1 top-1 size-1.5 rounded-full bg-accent-2"
				/>
			)}
		</div>
	);
}
