import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";

const layers: HTMLElement[] = [];
const subscribers = new Set<() => void>();

const publish = (): void => {
	for (const notify of subscribers) notify();
};

const subscribeToLayers = (notify: () => void): (() => void) => {
	subscribers.add(notify);
	return () => {
		subscribers.delete(notify);
	};
};

const topLayer = (): HTMLElement | null => layers[layers.length - 1] ?? null;
const noLayer = (): null => null;
const subscribeToNothing = (): (() => void) => () => {};
const inBrowser = (): boolean => true;
const onServer = (): boolean => false;

const useIsomorphicLayoutEffect =
	typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Ref callback for a modal surface's elevation layer — the empty, click-through
 * box it renders between its scrim and its panel.
 *
 * A modal surface is one stacking context holding both its scrim and its panel,
 * so "above the scrim, under the panel" cannot be reached with a z-index from
 * outside it: any value that clears the scrim clears the panel too, and the
 * control ends up painted over the panel's own content. Inside the surface both
 * are `z-auto` and DOM order decides, so the layer's position between them is
 * the whole of the rule.
 */
export const useScrimElevationLayer = (): ((
	node: HTMLElement | null,
) => void) => {
	const [layer, setLayer] = useState<HTMLElement | null>(null);

	useEffect(() => {
		if (!layer) return;
		layers.push(layer);
		publish();
		return () => {
			const index = layers.lastIndexOf(layer);
			if (index !== -1) layers.splice(index, 1);
			publish();
		};
	}, [layer]);

	return setLayer;
};

export interface AboveScrimProps {
	children?: ReactNode;
	/**
	 * Whether this control belongs on top of the modal surface that is up. Only
	 * the control that opened it does; every other verb in the toolbar stays
	 * where the scrim put it, out of reach.
	 */
	elevated?: boolean;
	/** Layout classes for the slot the control occupies in its own toolbar. */
	className?: string;
}

/**
 * Keeps its child pressable while a modal surface's scrim covers the toolbar it
 * sits in — the control that opened the modal has to be able to close it again
 * (#747).
 *
 * The child is rendered into a host element this component owns rather than
 * into the tree directly, so elevating it is a move of that one host between
 * the slot and the modal's elevation layer. The React subtree never changes
 * position, so the button keeps its DOM identity across the move and the
 * modal's focus restore still finds the element it remembered on the way in.
 * The slot holds the size it last measured, so the toolbar does not reflow
 * around the gap.
 */
export function AboveScrim({
	children,
	elevated: wanted = false,
	className,
}: AboveScrimProps) {
	const topmost = useSyncExternalStore(subscribeToLayers, topLayer, noLayer);
	const layer = wanted ? topmost : null;
	const rendersInBrowser = useSyncExternalStore(
		subscribeToNothing,
		inBrowser,
		onServer,
	);
	const slotRef = useRef<HTMLSpanElement>(null);
	const [host] = useState<HTMLDivElement | null>(() =>
		typeof document === "undefined" ? null : document.createElement("div"),
	);
	const [slotSize, setSlotSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const portalled = rendersInBrowser && host !== null;
	const elevated = portalled && layer !== null && slotSize !== null;

	useIsomorphicLayoutEffect(() => {
		const slot = slotRef.current;
		if (!slot || layer) return;
		const measure = (): void => {
			const box = slot.getBoundingClientRect();
			setSlotSize((current) =>
				current && current.width === box.width && current.height === box.height
					? current
					: { width: box.width, height: box.height },
			);
		};
		measure();
		if (typeof ResizeObserver !== "function") return;
		const observer = new ResizeObserver(measure);
		observer.observe(slot);
		return () => observer.disconnect();
	}, [layer]);

	useIsomorphicLayoutEffect(() => {
		const slot = slotRef.current;
		if (!host || !slot) return;
		const parent = elevated && layer ? layer : slot;
		if (host.parentElement !== parent) {
			const focused = document.activeElement;
			const carried =
				focused instanceof HTMLElement && host.contains(focused)
					? focused
					: null;
			parent.appendChild(host);
			carried?.focus();
		}
		if (parent === slot) {
			host.removeAttribute("style");
			host.style.display = "contents";
			return;
		}
		const place = (): void => {
			const slotBox = slot.getBoundingClientRect();
			const layerBox = parent.getBoundingClientRect();
			host.style.display = "block";
			host.style.position = "absolute";
			host.style.top = `${slotBox.top - layerBox.top}px`;
			host.style.left = `${slotBox.left - layerBox.left}px`;
			host.style.width = `${slotBox.width}px`;
			host.style.height = `${slotBox.height}px`;
			host.style.pointerEvents = "auto";
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [host, layer, elevated]);

	return (
		<>
			<span
				ref={slotRef}
				className={cn("inline-flex", className)}
				style={
					elevated && slotSize
						? { width: slotSize.width, height: slotSize.height }
						: undefined
				}
			>
				{portalled ? null : children}
			</span>
			{portalled && host ? createPortal(children, host) : null}
		</>
	);
}
