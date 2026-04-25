import { cn } from "@/lib/utils";
import { computeColorClass, computeInitials } from "./avatar-utils.js";

interface AvatarProps {
	name?: string;
	email?: string;
	size?: number;
	className?: string;
}

export const Avatar = ({ name, email, size = 40, className }: AvatarProps) => {
	const initials = computeInitials(name, email);
	const colorClass = computeColorClass(name, email);
	const label = name?.trim() || email?.trim() || "Unknown sender";
	// Scale the font with the circle: ~40% of diameter renders well at 40px
	// and degrades gracefully on larger or smaller sizes.
	const fontSize = Math.round(size * 0.4);

	return (
		<div
			role="img"
			aria-label={`Avatar for ${label}`}
			title={label}
			style={{ width: size, height: size, fontSize }}
			className={cn(
				"shrink-0 rounded-full flex items-center justify-center font-medium text-white select-none",
				colorClass,
				className,
			)}
		>
			{initials}
		</div>
	);
};
