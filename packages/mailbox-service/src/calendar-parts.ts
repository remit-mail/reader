/// <reference path="./types/mailparser-augment.d.ts" />

import { ROOT_PART_PATH } from "@remit/data-ports/id";
import { CalendarSuggestionSource } from "@remit/domain-enums";
import type { Attachment, ParsedMail } from "mailparser";

/**
 * One `text/calendar` part of a message, and where it sat.
 *
 * The distinction between an inline part and an attached one is not cosmetic:
 * a scheduling client sends the invitation inline as part of a
 * `multipart/alternative`, while a client that cannot speak iTIP attaches an
 * `.ics` file. Both carry the same bytes, and a card says which it read.
 */
export interface CalendarPart {
	partPath: string;
	source:
		| typeof CalendarSuggestionSource.IcalendarPart
		| typeof CalendarSuggestionSource.IcalendarAttachment;
	icalData: string;
}

const isCalendar = (attachment: Attachment): boolean =>
	(attachment.contentType ?? "").toLowerCase().startsWith("text/calendar");

/**
 * Every `text/calendar` part of a parsed message, in declaration order.
 *
 * Reads mailparser's `attachments[]`, which is where every non-`text/plain`,
 * non-`text/html` leaf lands — the same list the header classifier already
 * looks at to route an invitation to `transactional`.
 */
export const calendarParts = (parsed: ParsedMail): CalendarPart[] =>
	(parsed.attachments ?? []).filter(isCalendar).map((attachment) => ({
		partPath: attachment.partId ?? ROOT_PART_PATH,
		source:
			attachment.contentDisposition === "attachment"
				? CalendarSuggestionSource.IcalendarAttachment
				: CalendarSuggestionSource.IcalendarPart,
		icalData: attachment.content.toString("utf8"),
	}));
