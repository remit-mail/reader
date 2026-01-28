import { cn } from "@/lib/utils";

interface BadgeProps {
	count: number;
	totalCount?: number;
	className?: string;
}

const formatCount = (count: number, max = 999): string => {
	if (count > max) return `${max}+`;
	return String(count);
};

const formatTooltip = (
	count: number,
	totalCount?: number,
): string | undefined => {
	if (totalCount === undefined) return undefined;
	return `${count} unread / ${totalCount} total`;
};

export const Badge = ({ count, totalCount, className }: BadgeProps) => {
	if (count <= 0) return null;

	const displayCount = formatCount(count);
	const tooltip = formatTooltip(count, totalCount);

	return (
		<span
			className={cn(
				"inline-flex items-center justify-center rounded-full bg-primary font-medium text-primary-foreground",
				"px-1.5 py-0.5 text-[10px] min-w-5",
				"sm:px-2 sm:text-xs sm:min-w-6",
				className,
			)}
			title={tooltip}
		>
			{displayCount}
		</span>
	);
};
