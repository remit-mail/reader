import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
	children: ReactNode;
	className?: string;
	withBorder?: boolean;
}

export const Panel = ({
	children,
	className,
	withBorder = true,
}: PanelProps) => (
	<div
		className={cn(
			"h-full overflow-y-auto",
			withBorder && "border-r border-border",
			className,
		)}
	>
		{children}
	</div>
);
