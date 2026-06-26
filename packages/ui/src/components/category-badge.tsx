import { cn } from "../lib/cn.js";

export type MessageCategory =
	| "personal"
	| "newsletter"
	| "marketing"
	| "automated"
	| "transactional"
	| "social";

/**
 * Display label for a message category badge.
 *
 * Per EDD #232: `personal` is the default fallback and never renders a badge,
 * so it has no entry here. `transactional` shows as "receipt" and `automated`
 * shows as "notification" — wording chosen so the badge reads naturally next
 * to a subject line.
 */
const CATEGORY_LABELS: Record<Exclude<MessageCategory, "personal">, string> = {
	newsletter: "newsletter",
	marketing: "marketing",
	automated: "notification",
	transactional: "receipt",
	social: "social",
};

export const getCategoryLabel = (
	category: MessageCategory | undefined,
): string | null => {
	if (!category || category === "personal") return null;
	return CATEGORY_LABELS[category];
};

export interface CategoryBadgeProps {
	category: MessageCategory | undefined;
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
