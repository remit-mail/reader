/**
 * The binding between the address, this device's stored preference and what the
 * `/mail` shell has up: pane 4 and the one overlay that may cover it.
 *
 * The rail goes up two ways and they are not the same fact. The reader's own
 * control states where they want the rail from now on, so it writes the
 * preference. A raise — the DKIM auto-open, the authenticity banner's "Why?" —
 * surfaces the rail for the thread in front of them and must leave the stored
 * preference alone: one message signed by the wrong domain used to collapse
 * into "keep the rail up forever", for every later thread and every later
 * session (#778).
 *
 * Both verbs land in the address, because the address owns what is up wherever
 * it says anything at all and the preference speaks only where it is silent
 * (`docs/architecture/url-state.md`, R3).
 */
import { useCallback, useState } from "react";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import {
	readIntelligencePref,
	resolveRailOpen,
	writeIntelligencePref,
} from "@/lib/intelligence-pref";
import {
	isOverlayPanel,
	type OverlayPanel,
	useOpenPanels,
	useOpenThreadPath,
	useSetOpenPanels,
} from "@/routing";

export interface RailPanels {
	/** The overlay the address holds: the nav slide-over or the shortcuts sheet. */
	openOverlay: OverlayPanel | undefined;
	/** Whether pane 4 is up. */
	intelligenceOpen: boolean;
	showOverlay: (overlay: OverlayPanel | undefined) => void;
	/** The reader's own control, which is what a stored preference is made of. */
	toggleIntelligence: () => void;
	/** Puts the rail up for the thread in front of the reader, and nothing more. */
	raiseIntelligence: () => void;
}

export const useRailPanels = (): RailPanels => {
	const tier = useLayoutTier();
	// The panels the address carries (#722): the intelligence rail, the nav
	// slide-over and the shortcuts sheet. The rail is a pane and the other two
	// cover it, so the address holds a pane and an overlay at once — a sheet
	// opening never takes the rail down — while two overlays cannot both be up.
	const openPanels = useOpenPanels();
	const setOpenPanels = useSetOpenPanels();
	const openOverlay = openPanels.find(isOverlayPanel);
	// Pane 4 on desktop, the details drawer below it. `resolveRailOpen` is the
	// one place the address and the stored preference meet: the address decides
	// whenever it says anything at all, and the preference opens the rail with
	// the thread where it is silent (#782).
	const openThread = useOpenThreadPath();
	// Held in state, not read back from storage each render: closing the rail
	// where the address is silent changes nothing about the address, and the
	// answer has to move anyway.
	const [prefersRail, setPrefersRail] = useState(readIntelligencePref);
	const intelligenceOpen = resolveRailOpen({
		panels: openPanels,
		prefersOpen: prefersRail,
		isDesktop: tier === "desktop",
		hasThread: openThread !== undefined,
	});
	// Every write states the whole set, because it is composed from what is
	// showing rather than from what the address happens to spell: the rail open
	// by preference alone is still open, and an overlay must not close it.
	const showPanels = useCallback(
		(rail: boolean, overlay: OverlayPanel | undefined) => {
			setOpenPanels([
				...(rail ? (["intelligence"] as const) : []),
				...(overlay ? [overlay] : []),
			]);
		},
		[setOpenPanels],
	);
	const showOverlay = useCallback(
		(overlay: OverlayPanel | undefined) => {
			showPanels(intelligenceOpen, overlay);
		},
		[intelligenceOpen, showPanels],
	);
	const toggleIntelligence = useCallback(() => {
		const open = !intelligenceOpen;
		writeIntelligencePref(open);
		setPrefersRail(open);
		showPanels(open, openOverlay);
	}, [intelligenceOpen, openOverlay, showPanels]);
	const raiseIntelligence = useCallback(() => {
		showPanels(true, openOverlay);
	}, [openOverlay, showPanels]);

	return {
		openOverlay,
		intelligenceOpen,
		showOverlay,
		toggleIntelligence,
		raiseIntelligence,
	};
};
