export const WELLKNOWN_INBOUND_THRESHOLD = 3;
export const WELLKNOWN_REPLY_THRESHOLD = 1;
export const WELLKNOWN_INBOUND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface WellknownEngagementSnapshot {
	inboundCount?: number;
	replyCount?: number;
	lastInboundAt?: number;
	isBulk?: boolean;
	flags?: { wellknown?: { value: boolean } | undefined };
}

export const shouldPromoteWellknown = (
	snapshot: WellknownEngagementSnapshot,
	now: number,
): boolean => {
	if (snapshot.flags?.wellknown?.value === true) return false;

	const replyCount = snapshot.replyCount ?? 0;
	const inboundCount = snapshot.inboundCount ?? 0;
	const replied = replyCount >= WELLKNOWN_REPLY_THRESHOLD;
	const inboundEnough =
		!snapshot.isBulk && inboundCount >= WELLKNOWN_INBOUND_THRESHOLD;
	if (!replied && !inboundEnough) return false;

	const lastInboundAt = snapshot.lastInboundAt;
	if (lastInboundAt === undefined) return false;
	if (now - lastInboundAt > WELLKNOWN_INBOUND_WINDOW_MS) return false;

	return true;
};
