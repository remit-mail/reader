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
	upsertCorrespondentAddress(input: CreateAddressInput): Promise<AddressItem>;
	upsertJunkAddress(input: CreateAddressInput): Promise<AddressItem>;
	reconcileJunkOnlyForMessage(messageId: string): Promise<void>;
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
	/**
	 * The account's addresses, most worth suggesting first: where the search term
	 * hit — the start of a value before the middle of one, and the display name
	 * before the local part, the domain and the whole address — then the account's
	 * standing for the sender, how much it corresponds with it, how recently, and
	 * the stored compound and id last so the order is total. Without a term every
	 * row scores the same match, so the remaining keys decide and the listing comes
	 * back by standing, correspondence and recency rather than alphabetically.
	 */
	listByAccountConfig(input: {
		accountConfigId: string;
		/**
		 * Matched as a substring of the display name, the local part, the domain
		 * and the whole address, so `po`, `locatie`, `amsterdam`, `pocahondas.nl`
		 * and `amsterdam@pocahondas.nl` all resolve
		 * `Pocahondas locatie amsterdam <amsterdam@pocahondas.nl>`. A name outside
		 * ASCII (`Öz` for `Özcan Bakker`) resolves through the folded compound.
		 */
		search?: string;
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
