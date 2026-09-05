/**
 * The full-screen flow chrome: a fixed header carrying back and cancel, one
 * scrolling body, and a fixed footer in the thumb zone. Every multi-decision
 * surface on a phone is this shape, so there is one implementation of it.
 */

import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { cn } from "../lib/cn.js";
import { useModalFocus } from "../lib/use-modal-focus.js";

export interface FlowStepRailProps {
	/** How many steps the flow walks. */
	count: number;
	/** Zero-based index of the step on screen. */
	activeStep: number;
}

export function FlowStepRail({ count, activeStep }: FlowStepRailProps) {
	return (
		<ol className="flex items-center gap-1.5" aria-label="Progress">
			{Array.from({ length: count }, (_, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: a rail segment is its position
					key={i}
					className="flex flex-1 items-center gap-1.5"
				>
					<span
						className={cn(
							"h-1 flex-1 rounded-full transition-colors",
							i <= activeStep ? "bg-accent" : "bg-surface-sunken",
						)}
						aria-current={i === activeStep ? "step" : undefined}
					/>
				</li>
			))}
		</ol>
	);
}

export interface FlowScreenProps {
	title: string;
	subtitle?: string;
	/** The step labels in order. One label means one page and no rail. */
	steps: readonly string[];
	activeStep: number;
	onBack: () => void;
	onExit: () => void;
	/** Omitted where the screen is read rather than answered. */
	footer?: ReactNode;
	children: ReactNode;
	/**
	 * `scroll` pads the body and scrolls it. `fill` hands the whole region to a
	 * child that carries its own header and scrolling.
	 */
	bodyFit?: "scroll" | "fill";
	/**
	 * `viewport` covers the window and becomes a centred modal from 768px up.
	 * `container` fills the nearest positioned ancestor and stays full-bleed,
	 * for a surface that is already sized to a phone.
	 */
	anchor?: "viewport" | "container";
}

/**
 * The body is the only scrolling region, so back and the footer's controls
 * never leave the screen. The screen covers what opened it, which is why it
 * takes the accessibility tree with it.
 */
export function FlowScreen({
	title,
	subtitle,
	steps,
	activeStep,
	onBack,
	onExit,
	footer,
	children,
	anchor = "viewport",
	bodyFit = "scroll",
}: FlowScreenProps) {
	const contained = anchor === "container";
	const screenRef = useRef<HTMLDivElement>(null);
	// On screen for as long as it is mounted, so the trap is open with it.
	useModalFocus(screenRef, true);
	return (
		<div
			ref={screenRef}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			className={cn(
				"z-50 flex flex-col font-sans text-fg",
				contained
					? "absolute inset-0"
					: "fixed inset-0 md:items-center md:justify-center md:bg-black/40 md:p-6",
			)}
		>
			<div
				className={cn(
					"flex min-h-0 w-full flex-1 flex-col bg-canvas",
					!contained &&
						"md:h-[45rem] md:max-h-[calc(100dvh-3rem)] md:w-[35rem] md:max-w-[calc(100vw-3rem)] md:flex-none md:overflow-hidden md:rounded-xl md:border md:border-line md:shadow-lg",
				)}
			>
				<header
					className={cn(
						"shrink-0 border-b border-line px-3 pb-2",
						contained
							? "pt-3"
							: "pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:pt-3",
					)}
				>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={onBack}
							aria-label="Back"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<ArrowLeft className="size-5" />
						</button>
						<div className="min-w-0 flex-1 text-center">
							<h1 className="truncate text-sm font-semibold">{title}</h1>
							{subtitle && (
								<p className="truncate text-2xs text-fg-muted">{subtitle}</p>
							)}
						</div>
						<button
							type="button"
							onClick={onExit}
							aria-label="Cancel"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<X className="size-5" />
						</button>
					</div>
					{steps.length > 1 && (
						<div className="space-y-1 px-1 pt-2">
							<FlowStepRail count={steps.length} activeStep={activeStep} />
							<p className="text-2xs text-fg-subtle">
								Step {activeStep + 1} of {steps.length} · {steps[activeStep]}
							</p>
						</div>
					)}
				</header>

				<div
					className={cn(
						"min-h-0 flex-1",
						bodyFit === "fill"
							? "overflow-hidden"
							: "overflow-y-auto px-4 py-4",
					)}
				>
					{children}
				</div>

				{footer && (
					<footer
						className={cn(
							"shrink-0 border-t border-line px-4 py-3",
							contained
								? ""
								: "pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3",
						)}
					>
						{footer}
					</footer>
				)}
			</div>
		</div>
	);
}
