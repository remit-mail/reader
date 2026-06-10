import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
	/** Slightly lifted surface with a hairline border. */
	raised?: boolean;
}

export function Card({ raised, className, ...props }: CardProps) {
	return (
		<div
			className={cn(
				"rounded-sm border border-line bg-surface",
				raised ? "bg-surface-raised shadow-sm" : "",
				className,
			)}
			{...props}
		/>
	);
}

export function CardHeader({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("px-4 pt-3 pb-2", className)} {...props} />;
}

export function CardTitle({
	className,
	...props
}: HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h3 className={cn("text-md font-semibold text-fg", className)} {...props} />
	);
}

export function CardBody({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("px-4 pb-3 text-sm text-fg-muted", className)}
			{...props}
		/>
	);
}
