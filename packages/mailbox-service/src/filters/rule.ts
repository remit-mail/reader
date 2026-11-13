import type {
	FilterItem,
	FilterRuleV1Item,
	FilterTestItem,
	ThreadMessageFieldTerm,
} from "@remit/data-ports";
import {
	FilterRuleAddressPart,
	FilterRuleHeader,
	FilterRuleMatch,
} from "@remit/domain-enums";
import { normalizeListId } from "./list-id.js";

export type GetDomain = typeof import("tldts")["getDomain"];

export interface FilterMessage {
	from: string;
	fromName: string;
	subject: string;
	text: string;
	listId: string;
}

type HeaderTest = Extract<FilterTestItem, { test: "header" }>;
type AddressTest = Extract<FilterTestItem, { test: "address" }>;
type HasWordsTest = Extract<FilterTestItem, { test: "hasWords" }>;
type FilterTestMatch = HeaderTest["match"];

const fold = (value: string): string => value.toLowerCase();

const compare = (
	match: FilterTestMatch,
	value: string,
	key: string,
): boolean =>
	match === FilterRuleMatch.Is
		? fold(value) === fold(key)
		: fold(value).includes(fold(key));

const hostOf = (address: string): string => {
	const at = address.lastIndexOf("@");
	return at >= 0 ? address.slice(at + 1) : address;
};

const localPartOf = (address: string): string => {
	const at = address.lastIndexOf("@");
	return at >= 0 ? address.slice(0, at) : "";
};

const registrableDomain = (
	getDomain: GetDomain,
	addressOrHost: string,
): string | null => getDomain(hostOf(addressOrHost.trim()));

const headerMatches = (test: HeaderTest, msg: FilterMessage): boolean => {
	const key = test.key.trim();
	if (key === "") return false;
	switch (test.header) {
		case FilterRuleHeader.From:
			return (
				compare(test.match, msg.from, key) ||
				compare(test.match, msg.fromName, key)
			);
		case FilterRuleHeader.Subject:
			return compare(test.match, msg.subject, key);
		case FilterRuleHeader.ListId: {
			const target = normalizeListId(key);
			return (
				target !== "" &&
				compare(test.match, normalizeListId(msg.listId), target)
			);
		}
	}
};

const addressMatches = (
	test: AddressTest,
	msg: FilterMessage,
	getDomain: GetDomain,
): boolean => {
	const key = test.key.trim();
	if (key === "") return false;
	const from = msg.from.trim();
	switch (test.part) {
		case FilterRuleAddressPart.All:
			return compare(test.match, from, key);
		case FilterRuleAddressPart.Localpart:
			return compare(test.match, localPartOf(from), key);
		case FilterRuleAddressPart.Domain:
			return compare(test.match, hostOf(from), key);
		case FilterRuleAddressPart.RegistrableDomain: {
			const domain = registrableDomain(getDomain, from);
			if (domain === null) return false;
			if (test.match === FilterRuleMatch.Contains) {
				return compare(test.match, domain, key);
			}
			const target = registrableDomain(getDomain, key);
			return target !== null && domain === target;
		}
	}
};

const testWords = (test: HasWordsTest): string[] =>
	test.words.flatMap((word) => word.split(/\s+/)).filter(Boolean);

const hasWordsMatches = (test: HasWordsTest, msg: FilterMessage): boolean => {
	const words = testWords(test);
	if (words.length === 0) return false;
	const fields = [msg.from, msg.fromName, msg.subject, msg.text];
	return words.every((word) =>
		fields.some((field) => fold(field).includes(fold(word))),
	);
};

export const evaluateTest = (
	test: FilterTestItem,
	msg: FilterMessage,
	getDomain: GetDomain,
): boolean => {
	switch (test.test) {
		case "allof":
			return (
				test.tests.length > 0 &&
				test.tests.every((child) => evaluateTest(child, msg, getDomain))
			);
		case "anyof":
			return test.tests.some((child) => evaluateTest(child, msg, getDomain));
		case "not":
			return !evaluateTest(test.operand, msg, getDomain);
		case "header":
			return headerMatches(test, msg);
		case "address":
			return addressMatches(test, msg, getDomain);
		case "hasWords":
			return hasWordsMatches(test, msg);
	}
};

export const evaluateRule = (
	rule: FilterRuleV1Item,
	msg: FilterMessage,
	getDomain: GetDomain,
): boolean => evaluateTest(rule.test, msg, getDomain);

export interface RuleNarrowing {
	terms: ThreadMessageFieldTerm[];
	operator: "and" | "or";
}

type LeafNarrowing =
	| { kind: "Term"; term: ThreadMessageFieldTerm }
	| { kind: "NeverMatches" }
	| { kind: "Unnarrowable" };

const UNNARROWABLE: LeafNarrowing = { kind: "Unnarrowable" };
const NEVER_MATCHES: LeafNarrowing = { kind: "NeverMatches" };

const senderTerm = (contains: string): LeafNarrowing => ({
	kind: "Term",
	term: { field: "sender", contains },
});

const leafNarrowing = (
	test: FilterTestItem,
	getDomain: GetDomain,
): LeafNarrowing => {
	switch (test.test) {
		case "header": {
			const key = test.key.trim();
			if (key === "") return NEVER_MATCHES;
			if (test.header === FilterRuleHeader.Subject) {
				return { kind: "Term", term: { field: "subject", contains: key } };
			}
			if (test.header === FilterRuleHeader.ListId) {
				const target = normalizeListId(key);
				if (target === "") return NEVER_MATCHES;
				return { kind: "Term", term: { field: "listId", contains: target } };
			}
			return senderTerm(key);
		}
		case "address": {
			const key = test.key.trim();
			if (key === "") return NEVER_MATCHES;
			if (
				test.part !== FilterRuleAddressPart.RegistrableDomain ||
				test.match === FilterRuleMatch.Contains
			) {
				return senderTerm(key);
			}
			const target = registrableDomain(getDomain, key);
			return target === null ? NEVER_MATCHES : senderTerm(target);
		}
		case "hasWords":
			return testWords(test).length === 0 ? NEVER_MATCHES : UNNARROWABLE;
		default:
			return UNNARROWABLE;
	}
};

const isLeaf = (test: FilterTestItem): boolean =>
	test.test === "header" || test.test === "address" || test.test === "hasWords";

const flatNarrowing = (
	tests: readonly FilterTestItem[],
	operator: RuleNarrowing["operator"],
	getDomain: GetDomain,
): RuleNarrowing | null => {
	if (tests.length === 0) return null;
	if (!tests.every(isLeaf)) return { terms: [], operator };
	const narrowings = tests.map((test) => leafNarrowing(test, getDomain));
	const terms = narrowings.flatMap((narrowing) =>
		narrowing.kind === "Term" ? [narrowing.term] : [],
	);
	if (operator === "and") {
		if (narrowings.some((narrowing) => narrowing.kind === "NeverMatches")) {
			return null;
		}
		return { terms, operator };
	}
	if (narrowings.every((narrowing) => narrowing.kind === "NeverMatches")) {
		return null;
	}
	if (narrowings.some((narrowing) => narrowing.kind === "Unnarrowable")) {
		return { terms: [], operator };
	}
	return { terms, operator };
};

export const ruleNarrowing = (
	rule: FilterRuleV1Item,
	getDomain: GetDomain,
): RuleNarrowing | null => {
	const { test } = rule;
	switch (test.test) {
		case "allof":
			return flatNarrowing(test.tests, "and", getDomain);
		case "anyof":
			return flatNarrowing(test.tests, "or", getDomain);
		case "not":
			return { terms: [], operator: "and" };
		default:
			return flatNarrowing([test], "and", getDomain);
	}
};

export type FilterPrecedence = Pick<
	FilterItem,
	"priority" | "actionChangedAt" | "filterId"
>;

export const compareFilterPrecedence = (
	a: FilterPrecedence,
	b: FilterPrecedence,
): number => {
	if (a.priority !== b.priority) return a.priority - b.priority;
	if (a.actionChangedAt !== b.actionChangedAt) {
		return b.actionChangedAt - a.actionChangedAt;
	}
	if (a.filterId === b.filterId) return 0;
	return a.filterId > b.filterId ? -1 : 1;
};

export const orderFilters = <T extends FilterPrecedence>(
	filters: readonly T[],
): T[] => [...filters].sort(compareFilterPrecedence);
