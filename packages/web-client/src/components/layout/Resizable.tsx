import {
	Panel,
	PanelGroup,
	type PanelGroupProps,
	type PanelProps,
	PanelResizeHandle,
	type PanelResizeHandleProps,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

export const ResizablePanelGroup = ({
	className,
	...props
}: PanelGroupProps) => (
	<PanelGroup
		className={cn(
			"flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
			className,
		)}
		{...props}
	/>
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
	className,
	...props
}: PanelResizeHandleProps) => (
	<PanelResizeHandle
		className={cn(
			"relative flex w-px items-center justify-center bg-line after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90 hover:bg-ring/50 transition-colors cursor-col-resize data-[panel-group-direction=vertical]:cursor-row-resize",
			className,
		)}
		{...props}
	/>
);

export type { PanelGroupProps, PanelProps, PanelResizeHandleProps };
