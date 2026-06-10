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

export type { PanelGroupProps, PanelProps, PanelResizeHandleProps };
