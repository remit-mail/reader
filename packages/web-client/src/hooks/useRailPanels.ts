/**
 * The binding between the address, this device's stored preference and what the
 * `/mail` shell has up: pane 4 and the one overlay that may cover it.
 *
 * The rail goes up two ways and they are not the same fact. The reader's own
 * control states where they want the rail from now on, so it writes both the
 * preference and the address. A raise — the DKIM auto-open, the authenticity
 * banner's "Why?" — surfaces the rail for the message in front of them and is
 * held here, in memory, against that message: it never writes the preference,
 * and opening anything else ends it. One message signed by the wrong domain used
 * to mean the rail was up for every later thread and every later session (#778).
 *
 * The raise stays out of the address because its whole copy is computed from the
 * open message — reload the URL and the mismatch raises it again on its own, so
 * putting it in the fragment would be a second owner of a fact the message
 * already holds (`docs/architecture/url-state.md`, R6).
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
	/** Whether pane 4 is up, by the reader's standing answer or a raise. */
	intelligenceOpen: boolean;
	showOverlay: (overlay: OverlayPanel | undefined) => void;
	/**
	 * The reader's own control, which is what a stored preference is made of —
	 * except over a rail only a raise has up, where it ends the raise and stores
	 * nothing.
	 */
	toggleIntelligence: () => void;
	/** Puts the rail up for the message in front of the reader, and no further. */
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
	// The message a raise belongs to. Naming it by address is what ends the raise
	// when the reader opens anything else, without a teardown that has to run.
	const openMessage = openThread
		? `${openThread.threadId}/${openThread.messageId ?? ""}`
		: null;
	const [raisedFor, setRaisedFor] = useState<string | null>(null);
	const visibility = {
		panels: openPanels,
		prefersOpen: prefersRail,
		isDesktop: tier === "desktop",
		hasThread: openThread !== undefined,
		openMessage,
	};
	const intelligenceOpen = resolveRailOpen({ ...visibility, raisedFor });
	// What the reader themselves have the rail at, which is what an address write
	// states. A raise is left out of it on purpose: a sheet opening over a
	// surfaced rail must not write that rail into the address as a choice.
	const chosenOpen = resolveRailOpen({ ...visibility, raisedFor: null });
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
			showPanels(chosenOpen, overlay);
		},
		[chosenOpen, showPanels],
	);
	const toggleIntelligence = useCallback(() => {
		// Putting away a rail that only a raise has up answers the surfacing, not
		// the question of where the reader wants the rail — the answer they gave
		// last stands, and the address never carried this rail to rewrite.
		if (intelligenceOpen && !chosenOpen) {
			setRaisedFor(null);
			return;
		}
		const open = !intelligenceOpen;
		writeIntelligencePref(open);
		setPrefersRail(open);
		setRaisedFor(null);
		showPanels(open, openOverlay);
	}, [chosenOpen, intelligenceOpen, openOverlay, showPanels]);
	const raiseIntelligence = useCallback(() => {
		setRaisedFor(openMessage);
	}, [openMessage]);

	return {
		openOverlay,
		intelligenceOpen,
		showOverlay,
		toggleIntelligence,
		raiseIntelligence,
	};
};
