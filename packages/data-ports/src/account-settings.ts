import { AccountSettingName } from "@remit/domain-enums";
import { z } from "zod";

export type AccountSettingNameValue =
	(typeof AccountSettingName)[keyof typeof AccountSettingName];

/**
 * Per-`kind` value schemas, one per variant of the `AccountSettingValue`
 * discriminated union in TypeSpec (`AccountSetting.tsp`). Authored here because
 * the registry is the binding authority for what a value must satisfy — these
 * are the contract every read and write is validated against.
 */
export const BooleanSettingSchema = z.object({
	kind: z.literal("Boolean"),
	value: z.boolean(),
});
export const StringSettingSchema = z.object({
	kind: z.literal("String"),
	value: z.string(),
});
export const NumberSettingSchema = z.object({
	kind: z.literal("Number"),
	value: z.number(),
});
export const StringListSettingSchema = z.object({
	kind: z.literal("StringList"),
	value: z.array(z.string()),
});
export const MapSettingSchema = z.object({
	kind: z.literal("Map"),
	value: z.record(z.string(), z.string()),
});
/**
 * MutedFlag-valued setting. The value is a rich mute object (`MutedFlag` in
 * TypeSpec / `@remit/api-openapi-types`): a boolean plus audit metadata. The
 * schema is authored here — generated packages ship only `.d.ts` for this shape,
 * so the registry owns the runtime contract a relocated mute flag is validated
 * against (RFC 032 lesson from the signature slice).
 */
export const MutedFlagSettingSchema = z.object({
	kind: z.literal("MutedFlag"),
	value: z.object({
		value: z.boolean(),
		setAt: z.number(),
		setBy: z.string().optional(),
		expiresAt: z.number().optional(),
		reason: z.string().optional(),
	}),
});

/**
 * RFC 032 Tier 1 registry: binds each setting `name` to the zod schema its
 * `value` must satisfy. The discriminated union (`kind`) types the shape on the
 * wire; this registry binds a name to one concrete shape, so a read or write of
 * a given setting is validated against exactly the variant it requires.
 *
 * Adding a setting key is a deliberate change: extend the `AccountSettingName`
 * enum in TypeSpec and add an entry here — never an ad-hoc, unvalidated value.
 */
export const accountSettingRegistry = {
	[AccountSettingName.Theme]: StringSettingSchema,
	[AccountSettingName.Density]: StringSettingSchema,
	[AccountSettingName.DefaultComposerFormat]: StringSettingSchema,
	[AccountSettingName.PinnedFolders]: StringListSettingSchema,
	[AccountSettingName.AccountSignaturePlainText]: StringSettingSchema,
	[AccountSettingName.AccountSignatureHtml]: StringSettingSchema,
	[AccountSettingName.AccountDisplayName]: StringSettingSchema,
	[AccountSettingName.AccountMuted]: MutedFlagSettingSchema,
	[AccountSettingName.MailboxDisplayName]: StringSettingSchema,
	[AccountSettingName.MailboxMuted]: MutedFlagSettingSchema,
	[AccountSettingName.FolderRoleAppointment]: StringSettingSchema,
	/**
	 * Deprecated tombstone: superseded by `FolderRoleAppointment` (RFC 032
	 * exclusive-folder-appointment, #976). Kept only so `baseSettingName`
	 * recognises leftover `MailboxRole#<mailboxId>` rows written by the #963/#964
	 * backfill instead of throwing `Unknown account setting name`; the read-side
	 * groupers (`groupAccountOverrides`, `groupMailboxOverrides`,
	 * `groupFolderAppointmentsByAccount`) already skip any base they don't
	 * explicitly handle, so a `MailboxRole` row is ignored, not surfaced. Do not
	 * write new rows under this name. Remove once the row-deletion migration ships.
	 */
	[AccountSettingName.MailboxRole]: StringSettingSchema,
} as const satisfies Record<AccountSettingNameValue, z.ZodTypeAny>;

export type AccountSettingRegistry = typeof accountSettingRegistry;

export type AccountSettingValueFor<N extends AccountSettingNameValue> = z.infer<
	AccountSettingRegistry[N]
>;

/**
 * Separator between a setting's base enum member and its per-target suffix in a
 * composite stored name (e.g. `AccountSignaturePlainText#<accountId>`). Some
 * settings are per-account, but `AccountSetting` is keyed per accountConfigId, so
 * the stored `name` encodes the target after this separator. The registry still
 * validates by the base member; readers filter by the suffix.
 */
export const SETTING_NAME_SEPARATOR = "#";

/**
 * A persisted setting `name`. Either a plain closed-enum member or a composite
 * `<base>#<suffix>` for a per-target setting. Always a `string` whose first
 * segment is a known base member.
 */
export type StoredSettingName = string;

/** Compose the stored name for a per-target setting (e.g. one signature per account). */
export function composeSettingName(
	base: AccountSettingNameValue,
	target: string,
): StoredSettingName {
	return `${base}${SETTING_NAME_SEPARATOR}${target}`;
}

const isAccountSettingNameValue = (
	value: string,
): value is AccountSettingNameValue =>
	Object.hasOwn(accountSettingRegistry, value);

/**
 * Derive the base enum member from a stored name. Strips the `#<suffix>` from a
 * composite name; returns a plain name unchanged. Throws when the base segment
 * is not a registered setting (let-it-crash — an unknown key is a programmer
 * error, never an ad-hoc column).
 */
export function baseSettingName(
	name: StoredSettingName,
): AccountSettingNameValue {
	const base = name.split(SETTING_NAME_SEPARATOR)[0] ?? "";
	if (!isAccountSettingNameValue(base)) {
		throw new Error(`Unknown account setting name: ${name}`);
	}
	return base;
}

/**
 * Every value shape the registry can hold. Useful where a value is handled
 * generically (e.g. the persisted `value` attribute) rather than per-name.
 */
export type AnyAccountSettingValue = z.infer<
	| typeof BooleanSettingSchema
	| typeof StringSettingSchema
	| typeof NumberSettingSchema
	| typeof StringListSettingSchema
	| typeof MapSettingSchema
	| typeof MutedFlagSettingSchema
>;

/**
 * Parse-and-narrow a value against the schema registered for `name`. Accepts a
 * plain enum member or a composite `<base>#<suffix>` name; validation resolves
 * to the base member's schema. Throws a ZodError on mismatch (let-it-crash);
 * returns the value typed to the variant the name requires.
 */
export function parseAccountSettingValue<N extends AccountSettingNameValue>(
	name: N,
	value: unknown,
): AccountSettingValueFor<N>;
export function parseAccountSettingValue(
	name: StoredSettingName,
	value: unknown,
): AnyAccountSettingValue;
export function parseAccountSettingValue(
	name: StoredSettingName,
	value: unknown,
): AnyAccountSettingValue {
	const schema = accountSettingRegistry[baseSettingName(name)];
	return schema.parse(value) as AnyAccountSettingValue;
}

/**
 * Non-throwing variant: returns the zod SafeParse result so a caller with a
 * recovery path can branch on `success`. Accepts composite names like above.
 */
export function safeParseAccountSettingValue<N extends AccountSettingNameValue>(
	name: N,
	value: unknown,
): z.SafeParseReturnType<unknown, AccountSettingValueFor<N>>;
export function safeParseAccountSettingValue(
	name: StoredSettingName,
	value: unknown,
): z.SafeParseReturnType<unknown, AnyAccountSettingValue>;
export function safeParseAccountSettingValue(
	name: StoredSettingName,
	value: unknown,
): z.SafeParseReturnType<unknown, AnyAccountSettingValue> {
	const schema = accountSettingRegistry[baseSettingName(name)];
	return schema.safeParse(value) as z.SafeParseReturnType<
		unknown,
		AnyAccountSettingValue
	>;
}
