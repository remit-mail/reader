import type {
	AccountConfigSchema,
	AccountSchema,
	AddressSchema,
	BodyPartContentSchema,
	BodyPartParameterSchema,
	BodyPartSchema,
	BodyPartStorageSchema,
	EnvelopeAddressSchema,
	EnvelopeSchema,
	MailboxLockSchema,
	MailboxSchema,
	MailboxSpecialUseEntrySchema,
	MailboxSpecialUseSchema,
	MessageFlagSchema,
	MessageSchema,
	OutboxMessageSchema,
	RawMessageStorageSchema,
	ThreadMessageSchema,
} from "@remit/api-zod-schemas";
import type { z } from "zod";

export type ResultList<T> = {
	items: T[];
	continuationToken: string | undefined;
};

/**
 * Page shape for internal, non-API-facing pagination (e.g. the scheduled-sync
 * tick paging through every account). `cursor` is a raw backend-native token —
 * unlike `ResultList.continuationToken` it carries no salt/tamper check, since
 * it never crosses a trust boundary. `null` means no further pages.
 */
export type AccountSchedulerPage = {
	items: AccountItem[];
	cursor: string | null;
};

export type ListOptions = {
	limit?: number;
	continuationToken?: string;
};

export type AccountItem = z.infer<typeof AccountSchema>;
export type AccountConfigItem = z.infer<typeof AccountConfigSchema>;
export type MailboxItem = z.infer<typeof MailboxSchema>;
export type ThreadMessageItem = z.infer<typeof ThreadMessageSchema>;
export type OutboxMessageItem = z.infer<typeof OutboxMessageSchema>;
export type MessageItem = z.infer<typeof MessageSchema>;
export type MessageFlagItem = z.infer<typeof MessageFlagSchema>;
export type BodyPartItem = z.infer<typeof BodyPartSchema>;
export type MessageReferenceItem = {
	messageReferenceId: string;
	messageId: string;
	envelopeId: string;
	messageIdValue: string;
	referenceType: string;
	referenceOrder: number;
	createdAt: number;
	updatedAt: number;
};
export type EnvelopeAddressItem = z.infer<typeof EnvelopeAddressSchema>;
export type BodyPartParameterItem = z.infer<typeof BodyPartParameterSchema>;
export type RawMessageStorageItem = z.infer<typeof RawMessageStorageSchema>;
export type BodyPartStorageItem = z.infer<typeof BodyPartStorageSchema>;
export type BodyPartContentItem = z.infer<typeof BodyPartContentSchema>;
export type EnvelopeItem = z.infer<typeof EnvelopeSchema>;
export type MailboxLockItem = z.infer<typeof MailboxLockSchema>;
export type MailboxSpecialUseItem = z.infer<
	typeof MailboxSpecialUseEntrySchema
>;
export type AddressItem = z.infer<typeof AddressSchema>;

export type MailboxSpecialUseValue = z.infer<typeof MailboxSpecialUseSchema>;

export type AccountSettingValue =
	| { kind: "Boolean"; value: boolean }
	| { kind: "String"; value: string }
	| { kind: "Number"; value: number }
	| { kind: "StringList"; value: string[] }
	| { kind: "Map"; value: Record<string, string> }
	| {
			kind: "MutedFlag";
			value: {
				value: boolean;
				setAt: number;
				setBy?: string;
				expiresAt?: number;
				reason?: string;
			};
	  };

export type AccountSettingItem = {
	accountSettingId: string;
	accountConfigId: string;
	name: string;
	value: AccountSettingValue;
	createdAt: number;
	updatedAt: number;
};

export type AccountExportRequestItem = {
	accountExportRequestId: string;
	accountConfigId: string;
	userId: string;
	state: "Failed" | "Pending" | "Processing" | "Ready";
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
	objectKey?: string;
	downloadUrl?: string;
	errorMessage?: string;
};

export type AccountDescription = {
	account: AccountItem[];
	mailbox: MailboxItem[];
};

export type AccountConfigDescription = {
	accountConfig: AccountConfigItem[];
	account: AccountItem[];
	address: AddressItem[];
};

export type MessageData = {
	envelope: EnvelopeItem[];
	messageReference: MessageReferenceItem[];
	envelopeAddress: EnvelopeAddressItem[];
	bodyPart: BodyPartItem[];
	bodyPartParameter: BodyPartParameterItem[];
	rawMessageStorage: RawMessageStorageItem[];
	bodyPartStorage: BodyPartStorageItem[];
	bodyPartContent: BodyPartContentItem[];
};

export type MessageDescription = {
	message: MessageItem[];
	messageFlag: MessageFlagItem[];
	envelope: EnvelopeItem[];
	messageReference: MessageReferenceItem[];
	envelopeAddress: EnvelopeAddressItem[];
	bodyPart: BodyPartItem[];
	bodyPartParameter: BodyPartParameterItem[];
	rawMessageStorage: RawMessageStorageItem[];
	bodyPartStorage: BodyPartStorageItem[];
	bodyPartContent: BodyPartContentItem[];
};

export type WithMailboxLockResult<T> = {
	executed: boolean;
	result?: T;
};

export type CreateAccountInput = Omit<
	AccountItem,
	| "accountId"
	| "createdAt"
	| "updatedAt"
	| "authType"
	| "smtpEnabled"
	| "smtpHost"
	| "smtpPort"
	| "smtpTls"
	| "smtpStartTls"
	| "smtpUsername"
> & {
	accountId?: string;
	authType?: AccountItem["authType"];
	smtpEnabled?: AccountItem["smtpEnabled"];
	smtpHost?: AccountItem["smtpHost"];
	smtpPort?: AccountItem["smtpPort"];
	smtpTls?: AccountItem["smtpTls"];
	smtpStartTls?: AccountItem["smtpStartTls"];
	smtpUsername?: AccountItem["smtpUsername"];
};

export type UpdateAccountInput = Partial<
	Omit<CreateAccountInput, "accountConfigId">
>;

export type CreateAccountConfigInput = Omit<
	AccountConfigItem,
	"accountConfigId" | "createdAt" | "updatedAt" | "state"
> & { accountConfigId?: string; state?: AccountConfigItem["state"] };

export type UpdateAccountConfigInput = Partial<
	Omit<CreateAccountConfigInput, "userId">
>;

export type CreateAccountExportRequestInput = Omit<
	AccountExportRequestItem,
	"accountExportRequestId" | "createdAt" | "updatedAt"
>;

export type UpdateAccountExportRequestInput = Partial<
	Pick<AccountExportRequestItem, "state" | "expiresAt" | "errorMessage"> & {
		objectKey?: string;
	}
>;

export type UpsertAccountSettingInput = {
	accountConfigId: string;
	name: string;
	value: AccountSettingValue;
};

export type AddressFlags = NonNullable<AddressItem["flags"]>;
export type FlagsMergePatch = {
	[K in keyof AddressFlags]?: AddressFlags[K] | null;
};

export type CreateAddressInput = Omit<
	AddressItem,
	| "addressId"
	| "createdAt"
	| "updatedAt"
	| "flags"
	| "inboundCount"
	| "outboundCount"
	| "replyCount"
	| "lastInboundAt"
	| "lastReplyAt"
> & {
	addressId: string;
	flags?: AddressFlags;
	inboundCount?: AddressItem["inboundCount"];
	outboundCount?: AddressItem["outboundCount"];
	replyCount?: AddressItem["replyCount"];
	lastInboundAt?: AddressItem["lastInboundAt"];
	lastReplyAt?: AddressItem["lastReplyAt"];
};

export type UpdateAddressInput = Partial<
	Omit<CreateAddressInput, "accountConfigId">
>;

export type CreateEnvelopeAddressInput = Omit<
	EnvelopeAddressItem,
	"envelopeAddressId" | "createdAt" | "updatedAt"
> & { envelopeAddressId: string };

export type CreateEnvelopeInput = Omit<
	EnvelopeItem,
	"envelopeId" | "createdAt" | "updatedAt"
> & { envelopeId: string };

export type UpdateEnvelopeInput = Partial<
	Omit<CreateEnvelopeInput, "messageId">
>;

export type BodyPartParameterUpsertInput = {
	parameterName: string;
	parameterValue: string;
};

export type BodyPartUpsertInput = {
	partPath: string;
	parentPartPath: string | null;
	mediaType: BodyPartItem["mediaType"];
	mediaSubtype: string;
	contentId?: string;
	contentDescription?: string;
	transferEncoding: BodyPartItem["transferEncoding"];
	sizeOctets: number;
	lineCount?: number;
	md5Hash?: string;
	disposition?: BodyPartItem["disposition"];
	dispositionFilename?: string;
	language?: string;
	location?: string;
	isMultipart: boolean;
	multipartSubtype?: BodyPartItem["multipartSubtype"];
	parameters: BodyPartParameterUpsertInput[];
};

export type BodyPartContentUpsertInput = {
	bodyPartId: string;
	content: string;
};

export type CreateMailboxInput = Omit<
	MailboxItem,
	"mailboxId" | "createdAt" | "updatedAt" | "namespaceType" | "parentMailboxId"
> & {
	namespaceType?: MailboxItem["namespaceType"];
	parentMailboxId?: MailboxItem["parentMailboxId"];
};

export type UpdateMailboxInput = Partial<Omit<CreateMailboxInput, "accountId">>;

export type CreateMessageInput = Omit<
	MessageItem,
	| "messageId"
	| "createdAt"
	| "updatedAt"
	| "status"
	| "syncStatus"
	| "category"
	| "hasListUnsubscribe"
	| "movedByRemit"
> & {
	messageId: string;
	status?: MessageItem["status"];
	syncStatus?: MessageItem["syncStatus"];
	category?: MessageItem["category"];
	hasListUnsubscribe?: MessageItem["hasListUnsubscribe"];
	movedByRemit?: MessageItem["movedByRemit"];
};

export type UpdateMessageInput = Partial<
	Omit<CreateMessageInput, "mailboxId" | "uid">
>;

export type UpdateMessageMoveInput = Partial<
	Pick<
		CreateMessageInput,
		| "mailboxId"
		| "uid"
		| "status"
		| "syncStatus"
		| "originalMailboxId"
		| "originalUid"
	>
>;

export type MessageIdSource = {
	messageId?: string;
	uid: number;
	mailboxId: string;
	date?: string;
	subject?: string;
	fromMailbox?: string;
	fromHost?: string;
};

export type CreateMessageFlagInput = Omit<
	MessageFlagItem,
	"messageFlagId" | "createdAt" | "updatedAt"
>;

export type CreateOutboxMessageInput = Omit<
	OutboxMessageItem,
	| "outboxMessageId"
	| "createdAt"
	| "updatedAt"
	| "ccAddresses"
	| "bccAddresses"
	| "references"
> & {
	ccAddresses?: string[];
	bccAddresses?: string[];
	references?: string[];
};

export type UpdateOutboxMessageInput = Partial<
	Pick<
		OutboxMessageItem,
		| "status"
		| "lastError"
		| "lastSmtpCode"
		| "sentAt"
		| "smtpMessageId"
		| "toAddresses"
		| "ccAddresses"
		| "bccAddresses"
		| "subject"
		| "textBody"
		| "htmlBody"
		| "inReplyTo"
		| "references"
	>
>;

export type CreateThreadMessageInput = Omit<
	ThreadMessageItem,
	"threadMessageId" | "createdAt" | "updatedAt" | "star" | "category"
> & {
	star?: ThreadMessageItem["star"];
	category?: ThreadMessageItem["category"];
};

export type UpdateThreadMessageInput = Partial<
	Omit<CreateThreadMessageInput, "accountConfigId" | "threadId" | "messageId">
>;

export type SearchOptions = {
	query?: string;
	subject?: string;
	from?: string;
	unread?: boolean;
	starred?: boolean;
	attachments?: boolean;
};
