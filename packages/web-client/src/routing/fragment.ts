import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
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

/**
 * The panels that outlive a navigation. The rail is chrome a reader keeps up
 * while they move from one conversation to the next; the slide-over and the
 * sheet are dismissed by going somewhere, which is what closing them means.
 */
const panelsSurvivingNavigation: readonly PanelFragment[] = ["intelligence"];

/**
 * A destination's `hash`, for a navigation that keeps the reader where they
 * are. The router drops the fragment on every navigation unless the destination
 * asks for it, so this is what a link or a `navigate` call passes to state that
 * rule rather than restate it.
 */
export function retainOpenPanel(hash?: string): string {
	const panel = parsePanelFragment(hash ?? "");
	if (!panel) return "";
	return panelsSurvivingNavigation.includes(panel) ? panel : "";
}

/**
 * Opens a panel, or closes whichever one is open.
 *
 * `replace`, because a panel is chrome over the current view rather than a place
 * to go: Back belongs to the message the reader came from, not to the rail they
 * just collapsed. The fragment names a panel and never an element, so it is not
 * an anchor to scroll to either.
 */
export function useSetOpenPanel(): (panel: PanelFragment | undefined) => void {
	const navigate = useNavigate();
	return useCallback(
		(panel: PanelFragment | undefined) => {
			navigate({
				search: true,
				hash: panel ?? "",
				replace: true,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);
}
