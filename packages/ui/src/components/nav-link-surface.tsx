import type { AnchorHTMLAttributes, AriaAttributes, Ref } from "react";
import { cn } from "../lib/cn.js";

export type NavLinkSurfaceVariant = "nav" | "row" | "inline";

/** Every `aria-current` value ARIA defines, minus the absent case. */
export type NavLinkCurrent = NonNullable<AriaAttributes["aria-current"]>;

export interface NavLinkSurfaceProps
	extends AnchorHTMLAttributes<HTMLAnchorElement> {
	variant?: NavLinkSurfaceVariant;
	/**
	 * Which kind of "current" this destination is. Sets `aria-current` and turns
	 * on the current-state styling together, so the two cannot disagree. A
	 * caller that already sets `aria-current` — the router binding does — gets
	 * the same styling without passing this.
	 */
	current?: NavLinkCurrent;
	ref?: Ref<HTMLAnchorElement>;
}

const OFFSET_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

/** A full-bleed row has no margin to spend on an offset ring. */
const INSET_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

const variants: Record<
	NavLinkSurfaceVariant,
	{ base: string; rest: string; current: string }
> = {
	nav: {
		base: cn(
			"flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
			OFFSET_RING,
		),
		rest: "text-fg-muted hover:bg-surface hover:text-fg",
		current: "bg-accent-2-soft font-medium text-accent-2",
	},
	row: {
		base: cn(
			"relative flex w-full items-start text-left transition-colors",
			INSET_RING,
		),
		rest: "hover:bg-surface-sunken",
		current: "bg-accent-2-soft",
	},
	inline: {
		base: cn(
			"rounded-sm underline-offset-2 transition-colors hover:underline",
			OFFSET_RING,
		),
		rest: "text-accent hover:text-accent-hover",
		current: "font-medium text-accent",
	},
};

function isCurrent(value: NavLinkCurrent | undefined): boolean {
	return value !== undefined && value !== false && value !== "false";
}

/**
 * The design system's navigation link: a real `<a>`, so middle-click, cmd-click,
 * "copy link address" and the browser's own Enter handling all work without a
 * single handler of ours. It carries appearance and accessible state only —
 * where the link goes is the router binding's business, and this package imports
 * no router.
 */
export function NavLinkSurface({
	variant = "nav",
	current,
	"aria-current": ariaCurrent,
	className,
	children,
	ref,
	...props
}: NavLinkSurfaceProps) {
	const resolved = current ?? ariaCurrent;
	const style = variants[variant];
	return (
		<a
			ref={ref}
			aria-current={resolved}
			className={cn(
				style.base,
				isCurrent(resolved) ? style.current : style.rest,
				className,
			)}
			{...props}
		>
			{children}
		</a>
	);
}
