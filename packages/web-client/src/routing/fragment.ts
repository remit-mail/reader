import { useLocation } from "@tanstack/react-router";
import { z } from "zod";

/**
 * The fragment tier carries panel visibility and nothing else — no identity, no
 * payload, no selection. A panel qualifies only when its own copy is
 * independent of in-memory data, so a cold load of the URL reproduces it
 * exactly.
 */
export const panelFragments = [
	"intelligence",
	"nav",
	"shortcuts",
	"filters",
] as const;

export type PanelFragment = (typeof panelFragments)[number];

const panelFragmentSchema = z.enum(panelFragments);

/**
 * A hand-edited or stale URL is a normal thing to receive, so an unrecognised
 * fragment reads as "no panel open" instead of throwing.
 */
export function parsePanelFragment(hash: string): PanelFragment | undefined {
	const parsed = panelFragmentSchema.safeParse(hash);
	return parsed.success ? parsed.data : undefined;
}

/** The panel the URL currently asks for, if any. */
export function useOpenPanel(): PanelFragment | undefined {
	return useLocation({
		select: (location) => parsePanelFragment(location.hash),
	});
}
