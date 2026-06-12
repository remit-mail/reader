/**
 * Tiny ring-buffer that captures the last N console errors, uncaught
 * exceptions, and unhandled promise rejections. Install once at app
 * startup; consumers call getRecentErrors() to read the buffer.
 *
 * Dependency-free and side-effect-free until install() is called.
 */

const MAX_ENTRIES = 20;

const ring: string[] = [];

function push(entry: string): void {
	ring.push(entry);
	if (ring.length > MAX_ENTRIES) ring.shift();
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
		push(
			`Uncaught ${event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message)} (${event.filename}:${event.lineno})`,
		);
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
		},
	);
}

/** Returns a copy of the captured entries (oldest first, up to 20). */
export function getRecentErrors(): readonly string[] {
	return ring.slice();
}
