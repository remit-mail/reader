import type {
	AddressItem,
	CreateAddressInput,
	CreateEnvelopeAddressInput,
	EnvelopeAddressItem,
	FlagsMergePatch,
	ResultList,
	UpdateAddressInput,
} from "../types.js";

export interface IAddressRepository {
	createAddress(input: CreateAddressInput): Promise<AddressItem>;
	upsertAddress(input: CreateAddressInput): Promise<AddressItem>;
	getAddress(accountConfigId: string, addressId: string): Promise<AddressItem>;
	getAddress(
		accountConfigId: string,
		addressIds: string[],
	): Promise<AddressItem[]>;
	updateAddress(
		accountConfigId: string,
		addressId: string,
		input: UpdateAddressInput,
	): Promise<AddressItem>;
	mergeFlags(
		accountConfigId: string,
		addressId: string,
		patch: FlagsMergePatch,
	): Promise<AddressItem>;
	promoteWellknownByUser(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<AddressItem>;
	demoteSenderTrust(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<AddressItem>;
	deleteAddress(accountConfigId: string, addressId: string): Promise<void>;
	incrementInboundCount(
		accountConfigId: string,
		addressId: string,
		now: number,
		isBulk?: boolean,
	): Promise<void>;
	incrementOutboundCount(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<void>;
	incrementReplyCount(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<void>;
	deleteManyAddresses(
		accountConfigId: string,
		addressIds: string[],
	): Promise<void>;
	listSuggestedVips(input: {
		accountConfigId: string;
		limit?: number;
	}): Promise<AddressItem[]>;
	listByAccountConfig(input: {
		accountConfigId: string;
		normalizedCompound?: string;
		cursor?: string;
		limit?: number;
	}): Promise<ResultList<AddressItem>>;
	createEnvelopeAddress(
		input: CreateEnvelopeAddressInput,
	): Promise<EnvelopeAddressItem>;
	upsertEnvelopeAddress(
		input: CreateEnvelopeAddressInput,
	): Promise<EnvelopeAddressItem>;
	getEnvelopeAddress(envelopeAddressId: string): Promise<EnvelopeAddressItem>;
	getEnvelopeAddress(
		envelopeAddressIds: string[],
	): Promise<EnvelopeAddressItem[]>;
	deleteEnvelopeAddress(envelopeAddressId: string): Promise<void>;
	deleteManyEnvelopeAddresses(envelopeAddressIds: string[]): Promise<void>;
}
