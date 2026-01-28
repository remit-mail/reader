import { cn } from "@/lib/utils";

interface BadgeProps {
	count: number;
	className?: string;
}

export const Badge = ({ count, className }: BadgeProps) => {
	if (count <= 0) return null;

	return (
		<span
			className={cn(
				"inline-flex items-center justify-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground",
				className,
			)}
		>
			{count > 99 ? "99+" : count}
		</span>
	);
};
