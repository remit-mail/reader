import type { RemitImapMessageCategory } from "@remit/api-http-client/types.gen.ts";
import { cn } from "@/lib/utils";
import { getCategoryLabel } from "./category-display";

interface CategoryBadgeProps {
	category: RemitImapMessageCategory | undefined;
	/** Larger size for the open-message header. List rows use the default. */
	size?: "sm" | "md";
	className?: string;
}

/**
 * Inline category label for non-personal mail. Renders nothing for `personal`
 * or absent values so the existing list-row layout is unaffected for the
 * common case.
 *
 * Visual style matches the muted, low-emphasis aesthetic of the surrounding
 * row chrome — no color tabs, no full-width pill backgrounds.
 */
export const CategoryBadge = ({
	category,
	size = "sm",
	className,
}: CategoryBadgeProps) => {
	const label = getCategoryLabel(category);
	if (!label) return null;

	return (
		<span
			className={cn(
				"inline-flex items-center rounded border border-line bg-surface-sunken/50 font-medium uppercase tracking-wide text-fg-muted shrink-0",
				size === "sm" && "px-1.5 py-0 text-2xs leading-4",
				size === "md" && "px-2 py-0.5 text-xs",
				className,
			)}
			aria-label={`Category: ${label}`}
		>
			{label}
		</span>
	);
};
