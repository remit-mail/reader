import type { RemitImapMessageCategory } from "@remit/api-http-client/types.gen.ts";

/**
 * Display label for a message category badge.
 *
 * Per EDD #232: `personal` is the default fallback and never renders a badge,
 * so it has no entry here. `transactional` shows as "receipt" and `automated`
 * shows as "notification" — wording chosen so the badge reads naturally next
 * to a subject line.
 */
const CATEGORY_LABELS: Record<
	Exclude<RemitImapMessageCategory, "personal">,
	string
> = {
	newsletter: "newsletter",
	marketing: "marketing",
	automated: "notification",
	transactional: "receipt",
	social: "social",
};

export const getCategoryLabel = (
	category: RemitImapMessageCategory | undefined,
): string | null => {
	if (!category || category === "personal") return null;
	return CATEGORY_LABELS[category];
};
