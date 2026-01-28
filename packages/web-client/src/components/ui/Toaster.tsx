import { Toaster as Sonner } from "sonner";

export const Toaster = () => (
	<Sonner
		position="bottom-right"
		toastOptions={{
			className: "bg-popover text-popover-foreground border-border",
			style: {
				background: "hsl(var(--popover))",
				color: "hsl(var(--popover-foreground))",
				border: "1px solid hsl(var(--border))",
			},
		}}
	/>
);
