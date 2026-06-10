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
// Muted pastels of the retro palette: green, cyan, slate-teal, slate,
// mauve, sage. No warm coral — danger stays the only warm color in the UI.
const palette = [
	"oklch(0.6 0.08 150)",
	"oklch(0.6 0.08 185)",
	"oklch(0.6 0.08 215)",
	"oklch(0.6 0.07 250)",
	"oklch(0.6 0.07 310)",
	"oklch(0.62 0.07 110)",
];

// Cream text reads on every palette entry in both themes; never pure white.
const avatarFg = "oklch(0.97 0.012 90)";

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
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
				sizes[size],
				className,
			)}
			style={{ backgroundColor: bg, color: avatarFg }}
			aria-hidden
		>
			{initials(name)}
		</span>
	);
}
