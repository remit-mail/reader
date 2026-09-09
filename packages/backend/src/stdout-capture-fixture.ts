/**
 * A test's view of what a request wrote to the log.
 *
 * pino writes through `process.stdout` once its `write` is replaced, so the hook
 * is installed when this module is evaluated — import it above anything that
 * pulls in the logger. Writes pass through whenever nothing is capturing, so the
 * test runner's own output still reaches the terminal.
 */

const originalWrite = process.stdout.write.bind(process.stdout);
const written: string[] = [];
let capturing = false;

process.stdout.write = ((
	chunk: string | Uint8Array,
	...rest: unknown[]
): boolean => {
	if (capturing && typeof chunk === "string") {
		written.push(chunk);
		return true;
	}
	return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

export const captureStdout = async <T>(
	run: () => Promise<T>,
): Promise<{ result: T; logged: string }> => {
	written.length = 0;
	capturing = true;
	try {
		const result = await run();
		return { result, logged: written.join("") };
	} finally {
		capturing = false;
	}
};

export const restoreStdout = (): void => {
	process.stdout.write = originalWrite as typeof process.stdout.write;
};
