/**
 * Tiny ring-buffer that captures the last N console errors, uncaught
 * exceptions, and unhandled promise rejections. Install once at app
 * startup; consumers call getRecentErrors() to read the buffer.
 *
 * Dependency-free and side-effect-free until install() is called.
 */

import { reportFatalError } from "./fatal-error";

const MAX_ENTRIES = 20;

const ring: string[] = [];

// Browser-spec noise, not app errors: the ResizeObserver spec fires these when
// observation callbacks don't settle within a frame. They surface as window
// `error` events with a null `error` and are safe to ignore. The live message
// carries a trailing period, so strip it before matching this canonical set.
const BENIGN_RESIZE_OBSERVER_MESSAGES = new Set([
	"ResizeObserver loop limit exceeded",
	"ResizeObserver loop completed with undelivered notifications",
]);

function isBenignResizeObserverError(message: unknown): boolean {
	if (typeof message !== "string") return false;
	return BENIGN_RESIZE_OBSERVER_MESSAGES.has(message.replace(/\.\s*$/, ""));
}

function push(entry: string): void {
	ring.push(entry);
	if (ring.length > MAX_ENTRIES) ring.shift();
}

/**
 * Record a single line into the recent-errors ring. Exposed so the global
 * `reportFatalError` seam (lib/fatal-error.ts) can land fatal errors in the
 * same buffer the bug-report flow reads, without re-implementing the ring.
 */
export function recordError(entry: string): void {
	push(entry);
}

function formatArgs(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === "string") return a;
			if (a instanceof Error) return `${a.name}: ${a.message}`;
			try {
				return JSON.stringify(a);
			} catch {
				return String(a);
			}
		})
		.join(" ");
}

export function install(): void {
	const originalError = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		push(formatArgs(args));
		originalError(...args);
	};

	window.addEventListener("error", (event: ErrorEvent) => {
		if (isBenignResizeObserverError(event.message)) return;
		push(
			`Uncaught ${event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message)} (${event.filename}:${event.lineno})`,
		);
		// An uncaught exception is, by definition, unhandled — escalate it.
		reportFatalError(event.error ?? event.message);
	});

	window.addEventListener(
		"unhandledrejection",
		(event: PromiseRejectionEvent) => {
			const reason = event.reason;
			const detail =
				reason instanceof Error
					? `${reason.name}: ${reason.message}`
					: String(reason);
			push(`Unhandled rejection: ${detail}`);
			// A rejection that bubbles to the window was never handled by any
			// caller — route it through the same fatal seam.
			reportFatalError(reason);
		},
	);
}

/** Returns a copy of the captured entries (oldest first, up to 20). */
export function getRecentErrors(): readonly string[] {
	return ring.slice();
}
