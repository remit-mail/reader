import { useCallback, useEffect, useRef } from "react";
import { useReturnFromRedirect } from "./useReturnFromRedirect";

/** How the redirect ended: this window came back, or it never left. */
export type RedirectEnd = "returned" | "stalled";

/**
 * Long enough for a slow provider fetch to take the page away, short enough
 * that a control which is never going anywhere does not read as busy.
 */
export const REDIRECT_STALL_MS = 20_000;

export const REDIRECT_STALL_MESSAGE =
	"Couldn't open Microsoft's sign-in page. Check your connection, and anything blocking redirects, then try again.";

/**
 * Run `onEnded` when the window that left for an external identity provider is
 * being looked at again, and hand back the marker to call as it leaves.
 *
 * A control that starts a redirect stays busy until the redirect is over, and
 * neither the mutation settling nor the next look at this window proves that:
 * `window.location.assign` returns with the page still here while the browser
 * fetches the provider's, and an app-switch away and back during that fetch is
 * a look at a window that never left. Installed to a home screen there is no
 * address bar and app-switching is how people move around, so that early look
 * is the common case, not the corner one (#646). The page having actually been
 * hidden is what separates the two.
 *
 * Every return leg, not just the first: a user who came back mid-sign-in to
 * read a password has finished nothing, so the watch stays armed.
 *
 * The listeners are on from mount and `markRedirectStarted` runs synchronously
 * on the line before `assign`, so nothing here depends on a render landing
 * first.
 *
 * A page restored from the back-forward cache — browser Back out of the
 * provider's consent screen — is a return leg on its own evidence. Without it a
 * control that was left busy has nothing to clear it and stays busy for good.
 *
 * An `assign` that never navigates hides nothing and restores nothing, so no
 * return leg is ever coming and the control would read as busy until a reload
 * (#964). A page that has stayed visible for `REDIRECT_STALL_MS` since the
 * redirect started is that case: the watch ends as `"stalled"` so the caller
 * states the failure instead of settling in silence. Only visible time counts —
 * any hide is evidence the redirect did happen, so it stops the watch and
 * leaves the return leg to end it.
 */
export const useRedirectEnded = (
	onEnded: (end: RedirectEnd) => void,
): (() => void) => {
	const armed = useRef(false);
	const hidden = useRef(false);
	const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latest = useRef(onEnded);
	latest.current = onEnded;

	const stopStallWatch = useCallback((): void => {
		if (stallTimer.current === null) return;
		clearTimeout(stallTimer.current);
		stallTimer.current = null;
	}, []);

	const settle = useCallback((): void => {
		if (!armed.current || !hidden.current) return;
		stopStallWatch();
		hidden.current = false;
		latest.current("returned");
	}, [stopStallWatch]);

	useEffect(() => {
		const markHidden = () => {
			hidden.current = true;
			stopStallWatch();
		};
		const handleVisibility = () => {
			if (document.visibilityState !== "hidden") return;
			markHidden();
		};
		const handlePageShow = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			// A restored page is the whole round trip in one event: the hide that
			// preceded it belongs to the document this one resumes, and nothing
			// else is going to report it.
			markHidden();
			settle();
		};
		document.addEventListener("visibilitychange", handleVisibility);
		window.addEventListener("pagehide", markHidden);
		window.addEventListener("pageshow", handlePageShow);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibility);
			window.removeEventListener("pagehide", markHidden);
			window.removeEventListener("pageshow", handlePageShow);
			stopStallWatch();
		};
	}, [settle, stopStallWatch]);

	// Always listening: the gate is the pair of refs above, which a redirect
	// arms and a hidden interval satisfies, not whether this hook is mounted
	// with a flag already flipped.
	useReturnFromRedirect(true, settle);

	return useCallback(() => {
		armed.current = true;
		hidden.current = false;
		stopStallWatch();
		stallTimer.current = setTimeout(() => {
			stallTimer.current = null;
			// The redirect is over as far as this window is concerned: it decided
			// nothing, and a later look at a page that never left is not a return.
			armed.current = false;
			hidden.current = false;
			latest.current("stalled");
		}, REDIRECT_STALL_MS);
	}, [stopStallWatch]);
};
