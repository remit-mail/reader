import type {
	AnchorHTMLAttributes,
	ButtonHTMLAttributes,
	ReactNode,
} from "react";
import { cn } from "../lib/cn.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "touch";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
	/** Optional leading icon (lucide-react element). */
	icon?: ReactNode;
}

const base =
	"inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
	primary: "bg-accent text-accent-fg hover:bg-accent-hover",
	secondary:
		"bg-surface text-fg border border-line hover:bg-surface-sunken hover:border-line-strong",
	ghost: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
	danger: "bg-danger text-accent-fg hover:opacity-90",
};

const sizes: Record<Size, string> = {
	sm: "h-7 px-2.5 text-xs",
	md: "h-9 px-3.5 text-sm",
	/** 44px square — the touch-target floor (HIG 44 / Material 48-ish). For an
	 *  icon-only control; a control carrying a text label should size itself
	 *  with `md` plus an explicit `min-h-11` instead of stretching to square. */
	touch: "h-11 w-11 text-sm",
};

export function Button({
	variant = "primary",
	size = "md",
	icon,
	className,
	children,
	...props
}: ButtonProps) {
	return (
		<button
			type="button"
			className={cn(base, variants[variant], sizes[size], className)}
			{...props}
		>
			{icon}
			{children}
		</button>
	);
}

export interface ButtonLinkProps
	extends AnchorHTMLAttributes<HTMLAnchorElement> {
	variant?: Variant;
	size?: Size;
	icon?: ReactNode;
	/** Opens in a new tab with the repo's standard `rel` hardening. */
	external?: boolean;
}

/**
 * An anchor that carries the button styling — same base, so it keeps the
 * focus-visible ring a hand-rolled `<a className="bg-accent …">` drops.
 */
export function ButtonLink({
	variant = "primary",
	size = "md",
	icon,
	external,
	className,
	children,
	...props
}: ButtonLinkProps) {
	return (
		<a
			className={cn(base, variants[variant], sizes[size], className)}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			{...props}
		>
			{icon}
			{children}
		</a>
	);
}
