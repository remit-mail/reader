import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** One labelled band of the intelligence panel, shared by both its tabs. */
export function IntelligenceSection({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn("border-b border-line px-row-inset py-3", className)}
		>
			<h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</h3>
			<div className="mt-2">{children}</div>
		</section>
	);
}
