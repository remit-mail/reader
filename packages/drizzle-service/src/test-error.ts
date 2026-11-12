/** An `assert.rejects` check that matches the driver error drizzle carries on `.cause`. */
export const failedWith =
	(pattern: RegExp) =>
	(error: unknown): boolean => {
		let current: unknown = error;
		while (current instanceof Error) {
			if (pattern.test(current.message)) return true;
			current = current.cause;
		}
		return false;
	};
