import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Panel,
	PanelGroup,
	type PanelGroupProps,
	type PanelProps,
	PanelResizeHandle,
	type PanelResizeHandleProps,
} from "react-resizable-panels";
import { cn } from "../lib/cn.js";

/* ------------------------------------------------------------------ */
/* Resizable panes — same library + wrapper pattern as the production */
/* web client (react-resizable-panels), restyled on the design        */
/* tokens. The drag handle IS the hairline: a 1px --line divider with */
/* an invisible 6px hit area centered on it; it lifts to              */
/* --line-strong on hover and --accent while dragging.                */
/* ------------------------------------------------------------------ */

export function ResizablePanelGroup({ className, ...props }: PanelGroupProps) {
	return (
		<PanelGroup
			className={cn(
				"flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

export const ResizablePanel = Panel;

export function ResizableHandle({
	className,
	...props
}: PanelResizeHandleProps) {
	return (
		<PanelResizeHandle
			className={cn(
				// the visible 1px hairline
				"relative w-px shrink-0 bg-line transition-colors cursor-col-resize",
				// invisible ~6px hit area centered on the line
				"after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2",
				// affordance: hairline lifts on hover, accent while dragging
				"data-[resize-handle-state=hover]:bg-line-strong",
				"data-[resize-handle-state=drag]:bg-accent",
				"focus-visible:outline-none focus-visible:bg-accent",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Gives everything inside it a whole-pixel box. `react-resizable-panels` sizes a
 * pane with a fractional `flexGrow`, so a pane lands on 712.5px and every box
 * under it inherits the fraction — and a fraction is where the DOM's whole-pixel
 * measurements start disagreeing with each other. Floor rather than round, so
 * the box is never a hair wider than the pane holding it.
 */
export function WholePixelWidth({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(null);

	useEffect(() => {
		const pane = ref.current?.parentElement;
		if (!pane) return;
		const measure = () => {
			const next = Math.floor(pane.getBoundingClientRect().width);
			setWidth((prev) => (prev === next ? prev : next));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(pane);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={ref}
			className={className}
			style={width === null ? undefined : { width: `${width}px` }}
		>
			{children}
		</div>
	);
}

export type { PanelGroupProps, PanelProps, PanelResizeHandleProps };
