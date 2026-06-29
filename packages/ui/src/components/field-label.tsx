import type { LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
	/** Associates the label with its control via the control's id. */
	htmlFor: string;
}

export function FieldLabel({ className, children, ...props }: FieldLabelProps) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is always provided via the required props spread
		<label
			className={cn("mb-1 block text-xs font-medium text-fg-muted", className)}
			{...props}
		>
			{children}
		</label>
	);
}
