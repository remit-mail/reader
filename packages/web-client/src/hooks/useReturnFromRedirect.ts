import { useEffect, useRef } from "react";

/**
 * Run `onReturn` every time the app is looked at again while it has a window
 * out at an external identity provider.
 *
 * Microsoft sign-in is the one flow that leaves this origin, and where it comes
 * back to is not ours to decide: launched from a home screen on iOS the return
 * leg can land in the browser instead of the app window, which then holds a
 * view of a sign-in that finished somewhere else. The window being looked at is
 * the one that has to reconcile, so it asks the server what happened rather
 * than trusting what it last saw.
 *
 * Every look, not just the first: a user who switches back mid-sign-in to read
 * a password has not finished anything, and a check that spent itself on that
 * look would miss the return that matters.
 *
 * `pageshow` covers the back-forward cache, where a restored page fires no
 * visibility change.
 */
export const useReturnFromRedirect = (
	active: boolean,
	onReturn: () => void,
): void => {
	const latest = useRef(onReturn);
	latest.current = onReturn;

	useEffect(() => {
		if (!active) return;
		const handle = () => {
			if (document.visibilityState !== "visible") return;
			latest.current();
		};
		document.addEventListener("visibilitychange", handle);
		window.addEventListener("pageshow", handle);
		return () => {
			document.removeEventListener("visibilitychange", handle);
			window.removeEventListener("pageshow", handle);
		};
	}, [active]);
};
