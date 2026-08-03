import type { RemitImapStarColor } from "@remit/api-http-client/types.gen.ts";
import { StarColor } from "@remit/domain-enums";

/**
 * A star is a colour, and `none` is its named absent state. The value travels
 * whole and each consumer asks it the question it needs — whether a control
 * renders active here, which colour it paints there.
 */
export const isStarred = (star: RemitImapStarColor | undefined): boolean =>
	star !== undefined && star !== StarColor.None;

/** The colour a plain star/unstar lands on, matching what the server writes. */
export const nextStarColor = (starred: boolean): RemitImapStarColor =>
	starred ? StarColor.Yellow : StarColor.None;
