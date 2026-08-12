import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";

/**
 * The fragment tier carries panel visibility and nothing else — no identity, no
 * payload, no selection. A panel qualifies only when its own copy is
 * independent of in-memory data, so a cold load of the URL reproduces it
 * exactly.
 */
export const panelFragments = ["intelligence", "nav", "shortcuts"] as const;

export type PanelFragment = (typeof panelFragments)[number];

/**
 * The panels that cover the view rather than sit in it. The rail is a pane in
 * the shell's row and the other two are modal over it, so a sheet opening can
 * never take the rail down with it — the address holds the pane and the overlay
 * at once. Two overlays cannot be up together, because the second one hides the
 * first.
 */
export const overlayPanels = ["nav", "shortcuts"] as const;

export type OverlayPanel = (typeof overlayPanels)[number];

export const isOverlayPanel = (panel: PanelFragment): panel is OverlayPanel =>
	(overlayPanels as readonly PanelFragment[]).includes(panel);

const panelFragmentSchema = z.enum(panelFragments);

/**
 * The panels the address asks for, in the union's own order so one set of open
 * panels has one spelling. A hand-edited or stale URL is a normal thing to
 * receive, so an unrecognised name is dropped instead of throwing.
 */
export function parseOpenPanels(hash: string): readonly PanelFragment[] {
	const named = new Set(
		hash
			.split(",")
			.map((token) => panelFragmentSchema.safeParse(token))
			.filter((parsed) => parsed.success)
			.map((parsed) => parsed.data),
	);
	return panelFragments.filter((panel) => named.has(panel));
}

/** The address a set of open panels is written as. */
export function formatOpenPanels(panels: readonly PanelFragment[]): string {
	return panelFragments.filter((panel) => panels.includes(panel)).join(",");
}

/** The panels the address currently asks for. */
export function useOpenPanels(): readonly PanelFragment[] {
	const hash = useLocation({
		select: (location) => formatOpenPanels(parseOpenPanels(location.hash)),
	});
	return useMemo(() => parseOpenPanels(hash), [hash]);
}

/**
 * A destination's `hash`, for a navigation that keeps the reader where they
 * are. The router drops the fragment on every navigation unless the destination
 * asks for it, so this is what a link or a `navigate` call passes to state the
 * rule rather than restate it: a pane is chrome a reader keeps up while they
 * move from one conversation to the next, and an overlay is dismissed by going
 * somewhere, which is what closing it means.
 *
 * The parameter is optional because the router hands a `hash` updater the
 * previous fragment as `string | undefined`.
 */
export function retainOpenPanels(hash = ""): string {
	return formatOpenPanels(
		parseOpenPanels(hash).filter((panel) => !isOverlayPanel(panel)),
	);
}

/**
 * Puts a set of panels up, replacing whatever was up before.
 *
 * `replace`, because a panel is chrome over the current view rather than a place
 * to go: Back belongs to the message the reader came from, not to the rail they
 * just collapsed. The fragment names panels and never an element, so it is not
 * an anchor to scroll to either.
 */
export function useSetOpenPanels(): (panels: readonly PanelFragment[]) => void {
	const navigate = useNavigate();
	return useCallback(
		(panels: readonly PanelFragment[]) => {
			navigate({
				search: true,
				hash: formatOpenPanels(panels),
				replace: true,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);
}
