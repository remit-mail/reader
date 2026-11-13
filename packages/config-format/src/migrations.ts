import {
	FilterClauseField,
	FilterMatchOperator,
	FilterRuleAddressPart,
	FilterRuleHeader,
	FilterRuleMatch,
} from "@remit/domain-enums";
import { getDomain } from "tldts";
import { z } from "zod";
import { type ConfigFilterTest, FilterClauseSchema } from "./document.js";
import { ConfigVersionError } from "./errors.js";
import { CURRENT_SCHEMA_VERSION } from "./version.js";

export type ConfigDocumentShape = Record<string, unknown>;

/**
 * One step of the chain that lifts an older document to the current version.
 * A migration works on the raw object, before the strict parse: the shape it
 * receives satisfied an older schema, and the shape it returns is only claimed
 * to satisfy the next one.
 */
export type ConfigMigration = {
	readonly from: number;
	readonly to: number;
	migrate(document: ConfigDocumentShape): ConfigDocumentShape;
};

const V1FiltersSchema = z.array(
	z.looseObject({ literalClauses: z.array(z.unknown()), anchor: z.unknown() }),
);

/** An anchor-only filter has no clauses left to match on, so it goes with its anchor. */
const dropFilterAnchors: ConfigMigration = {
	from: 1,
	to: 2,
	migrate: (document) => ({
		...document,
		schemaVersion: 2,
		filters: V1FiltersSchema.parse(document.filters)
			.filter((filter) => filter.literalClauses.length > 0)
			.map(({ anchor: _anchor, ...filter }) => filter),
	}),
};

// `fromDomainTest` in @remit/data-ports: the value is read as a bare host, and a
// subdomain keeps that exact host.
const fromDomainTest = (value: string): ConfigFilterTest => {
	const trimmed =
		value
			.trim()
			.toLowerCase()
			.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
			.split("/")[0] ?? "";
	const host = trimmed
		.slice(trimmed.lastIndexOf("@") + 1)
		.replace(/^\.+|\.+$/g, "");
	return {
		test: "address",
		match: FilterRuleMatch.Is,
		part:
			getDomain(host) === host
				? FilterRuleAddressPart.RegistrableDomain
				: FilterRuleAddressPart.Domain,
		key: host,
	};
};

const clauseTest = (
	clause: z.infer<typeof FilterClauseSchema>,
): ConfigFilterTest => {
	switch (clause.field) {
		case FilterClauseField.From:
			return {
				test: "header",
				match: FilterRuleMatch.Contains,
				header: FilterRuleHeader.From,
				key: clause.value,
			};
		case FilterClauseField.Subject:
			return {
				test: "header",
				match: FilterRuleMatch.Contains,
				header: FilterRuleHeader.Subject,
				key: clause.value,
			};
		case FilterClauseField.ListId:
			return {
				test: "header",
				match: FilterRuleMatch.Is,
				header: FilterRuleHeader.ListId,
				key: clause.value,
			};
		case FilterClauseField.FromDomain:
			return fromDomainTest(clause.value);
		case FilterClauseField.HasWords:
			return {
				test: "hasWords",
				words: clause.value.split(/\s+/).filter(Boolean),
			};
	}
};

const V2FiltersSchema = z.array(
	z.looseObject({
		matchOperator: z.enum(FilterMatchOperator),
		literalClauses: z.array(FilterClauseSchema),
	}),
);

const filterClausesToRule: ConfigMigration = {
	from: 2,
	to: 3,
	migrate: (document) => ({
		...document,
		schemaVersion: 3,
		filters: V2FiltersSchema.parse(document.filters).map(
			({ matchOperator, literalClauses, ...filter }) => {
				const tests = literalClauses.map(clauseTest);
				return {
					...filter,
					rule: {
						version: 1,
						test:
							matchOperator === FilterMatchOperator.Or
								? { test: "anyof", tests }
								: { test: "allof", tests },
					},
					priority: 0,
					stop: false,
				};
			},
		),
	}),
};

/**
 * The golden v1 fixture is the seed that keeps the chain honest: every step
 * has a committed v1 document to lift, so the chain is exercised by the same
 * test that proves v1 still reads.
 */
export const configMigrations: readonly ConfigMigration[] = [
	dropFilterAnchors,
	filterClausesToRule,
];

/**
 * Apply the chain from `fromVersion` up to the current version. A gap in the
 * chain is a fault, not a skipped step — silently leaving a document at an old
 * version would hand the strict parse a shape it was never meant to see.
 */
export function liftToCurrentVersion(
	document: ConfigDocumentShape,
	fromVersion: number,
	migrations: readonly ConfigMigration[] = configMigrations,
	targetVersion: number = CURRENT_SCHEMA_VERSION,
): ConfigDocumentShape {
	let version = fromVersion;
	let lifted = document;
	while (version < targetVersion) {
		const step = migrations.find((migration) => migration.from === version);
		if (!step) throw new ConfigVersionError(fromVersion, targetVersion);
		lifted = step.migrate(lifted);
		version = step.to;
	}
	return lifted;
}
