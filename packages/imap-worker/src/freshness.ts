/** Whether work last done at `at` is due again: never done, or done `windowMs` ago or longer. */
export const isStale = (
	at: number | undefined,
	now: number,
	windowMs: number,
): boolean => !at || now - at >= windowMs;
