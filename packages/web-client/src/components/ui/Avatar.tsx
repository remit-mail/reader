import { cn } from "@/lib/utils";

interface AvatarProps {
	name?: string;
	email?: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const getInitials = (name?: string, email?: string): string => {
	if (name) {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}
	if (email) {
		const localPart = email.split("@")[0];
		return localPart.slice(0, 2).toUpperCase();
	}
	return "??";
};

// Generate a consistent color based on the email/name
const getAvatarColor = (name?: string, email?: string): string => {
	const str = email || name || "";
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash);
	}

	// Use a set of nice colors that work well on dark backgrounds
	const colors = [
		"bg-red-600",
		"bg-orange-600",
		"bg-amber-600",
		"bg-yellow-600",
		"bg-lime-600",
		"bg-green-600",
		"bg-emerald-600",
		"bg-teal-600",
		"bg-cyan-600",
		"bg-sky-600",
		"bg-blue-600",
		"bg-indigo-600",
		"bg-violet-600",
		"bg-purple-600",
		"bg-fuchsia-600",
		"bg-pink-600",
		"bg-rose-600",
	];

	return colors[Math.abs(hash) % colors.length];
};

const sizeClasses = {
	sm: "size-8 text-xs",
	md: "size-10 text-sm",
	lg: "size-12 text-base",
};

export const Avatar = ({
	name,
	email,
	size = "md",
	className,
}: AvatarProps) => {
	const initials = getInitials(name, email);
	const colorClass = getAvatarColor(name, email);

	return (
		<div
			className={cn(
				"shrink-0 rounded-full flex items-center justify-center font-medium text-white",
				colorClass,
				sizeClasses[size],
				className,
			)}
			title={name || email}
		>
			{initials}
		</div>
	);
};
