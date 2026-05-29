import { useMemo } from "react";
import { cn } from "../lib/cn.js";

export interface AvatarProps {
	name: string;
	email?: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizes = {
	sm: "size-7 text-2xs",
	md: "size-9 text-sm",
	lg: "size-11 text-md",
};

// Deterministic calm hue from a string — no random per-render flicker.
const palette = [
	"oklch(0.7 0.12 268)",
	"oklch(0.7 0.12 200)",
	"oklch(0.7 0.12 155)",
	"oklch(0.74 0.12 75)",
	"oklch(0.7 0.14 25)",
	"oklch(0.7 0.12 330)",
];

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, email, size = "md", className }: AvatarProps) {
	const bg = useMemo(() => {
		const key = email ?? name;
		let h = 0;
		for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
		return palette[h % palette.length];
	}, [name, email]);

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
				sizes[size],
				className,
			)}
			style={{ backgroundColor: bg }}
			aria-hidden
		>
			{initials(name)}
		</span>
	);
}
