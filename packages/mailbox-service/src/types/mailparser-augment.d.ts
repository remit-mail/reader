/**
 * `mailparser`'s `simpleParser` populates `partId` on every entry in
 * `parsed.attachments[]` at runtime (set inside `mail-parser.js:860`), but
 * the field is missing from `@types/mailparser`. Format is the IMAP
 * dot-numbered path (`"1"`, `"2.2.2"`, `"3"`) — the same shape mime-walker
 * writes to `BodyPart.partPath`. The body-part mapper uses it as the
 * primary structural pairing signal.
 */
declare module "mailparser" {
	interface Attachment {
		partId?: string;
	}
}

export {};
