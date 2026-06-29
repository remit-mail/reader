import { Check, Minus } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "../lib/cn.js";

export interface CheckboxProps
	extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
	/** Visible label; when set, the whole row is the ~44px touch target. */
	label?: ReactNode;
	/** Secondary line under the label. */
	description?: ReactNode;
	/** Tri-state tick: renders a dash. The input stays a real checkbox. */
	indeterminate?: boolean;
}

const box =
	"peer relative size-5 shrink-0 cursor-pointer appearance-none rounded-md border border-line-strong bg-surface outline-none transition-colors checked:border-positive checked:bg-positive indeterminate:border-positive indeterminate:bg-positive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

const mark =
	"pointer-events-none absolute inset-0 m-auto size-3.5 text-accent-fg";

export function Checkbox({
	label,
	description,
	indeterminate = false,
	checked,
	onChange,
	className,
	...props
}: CheckboxProps) {
	const ref = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);

	const control = (
		<span className="relative inline-flex">
			<input
				ref={ref}
				type="checkbox"
				checked={checked}
				onChange={onChange}
				className={box}
				{...props}
			/>
			<Check className={cn(mark, "hidden peer-checked:block")} aria-hidden />
			<Minus
				className={cn(mark, "hidden peer-indeterminate:block")}
				aria-hidden
			/>
		</span>
	);

	if (label === undefined && description === undefined) {
		return <span className={className}>{control}</span>;
	}

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: label wraps a custom component that handles focus
		<label
			className={cn(
				"flex min-h-11 cursor-pointer items-center gap-3 text-left",
				className,
			)}
		>
			{control}
			<span className="flex min-w-0 flex-col">
				{label !== undefined && (
					<span className="text-sm text-fg">{label}</span>
				)}
				{description !== undefined && (
					<span className="text-xs text-fg-subtle">{description}</span>
				)}
			</span>
		</label>
	);
}
