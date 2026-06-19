import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

const spinner = (): ReactNode => <Loader2 className="size-3.5 animate-spin" />;

export interface RowAction {
	label: string;
	onClick: () => void;
	icon?: ReactNode;
	variant?: "secondary" | "ghost";
	busy?: boolean;
	/** Replaces the label while busy (e.g. "Redirecting…"). */
	busyLabel?: string;
	/** Render the label visually hidden, leaving an icon-only button. */
	iconOnly?: boolean;
}

export interface RowDestructiveAction {
	label: string;
	onClick: () => void;
	icon?: ReactNode;
	busy?: boolean;
	busyLabel?: string;
	iconOnly?: boolean;
	/**
	 * When set, the destructive action reflects an inline confirm step
	 * (cancel / confirm) instead of firing immediately. Surfaces that own a
	 * separate confirm dialog omit this and handle confirmation themselves.
	 */
	confirm?: {
		/** Plain consequence shown before the confirm button. */
		prompt: string;
		confirmLabel?: string;
		cancelLabel?: string;
	};
}

export interface RowActionsProps {
	/** Secondary actions, rendered before the destructive one. */
	actions?: RowAction[];
	/** The single destructive action (delete / remove). */
	destructive?: RowDestructiveAction;
	className?: string;
}

const actionLabel = (label: string, iconOnly?: boolean): ReactNode =>
	iconOnly ? <span className="sr-only">{label}</span> : label;

/**
 * One shared per-row action cluster. Secondary actions plus an optional
 * destructive action that either reflects an inline confirm step or defers
 * to a surface-owned dialog. Never a naked destructive icon, never a
 * disabled control — busy state uses `aria-busy`.
 */
export function RowActions({
	actions = [],
	destructive,
	className,
}: RowActionsProps) {
	const [confirming, setConfirming] = useState(false);

	if (confirming && destructive?.confirm) {
		return (
			<div className={cn("flex items-center gap-2", className)}>
				<span className="text-xs text-fg-muted">
					{destructive.confirm.prompt}
				</span>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setConfirming(false)}
				>
					{destructive.confirm.cancelLabel ?? "Cancel"}
				</Button>
				<Button
					variant="danger"
					size="sm"
					aria-busy={destructive.busy}
					icon={destructive.busy ? spinner() : undefined}
					onClick={() => {
						if (destructive.busy) return;
						destructive.onClick();
					}}
				>
					{destructive.busy
						? (destructive.busyLabel ?? "Working…")
						: (destructive.confirm.confirmLabel ?? destructive.label)}
				</Button>
			</div>
		);
	}

	return (
		<div className={cn("flex items-center gap-2", className)}>
			{actions.map((action) => (
				<Button
					key={action.label}
					variant={action.variant ?? "ghost"}
					size="sm"
					aria-busy={action.busy}
					aria-label={action.iconOnly ? action.label : undefined}
					icon={action.busy ? spinner() : action.icon}
					onClick={() => {
						if (action.busy) return;
						action.onClick();
					}}
				>
					{action.busy && action.busyLabel
						? action.busyLabel
						: actionLabel(action.label, action.iconOnly)}
				</Button>
			))}
			{destructive && (
				<Button
					variant="ghost"
					size="sm"
					aria-busy={destructive.busy}
					aria-label={destructive.iconOnly ? destructive.label : undefined}
					icon={destructive.busy ? spinner() : destructive.icon}
					onClick={() => {
						if (destructive.busy) return;
						if (destructive.confirm) {
							setConfirming(true);
							return;
						}
						destructive.onClick();
					}}
				>
					{destructive.busy && destructive.busyLabel
						? destructive.busyLabel
						: actionLabel(destructive.label, destructive.iconOnly)}
				</Button>
			)}
		</div>
	);
}
