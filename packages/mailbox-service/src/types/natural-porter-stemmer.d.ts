// `natural` ships no per-file type declarations for its stemmer submodules —
// only the package-root barrel (`natural/lib/natural/index.d.ts`) and the
// `stemmers` submodule barrel (`natural/lib/natural/stemmers/index.d.ts`) are
// typed. Both barrels are CommonJS, so importing either unconditionally
// requires every stemmer they list — including Japanese (`stemmer_ja.js`,
// which pulls in its own `tokenizer_ja.js`) and Indonesian
// (`indonesian/stemmer_id.js`) — even when unused. Importing each Porter
// stemmer file this module actually uses, directly, avoids that; these
// ambient declarations cover the resulting import paths. Referenced via a
// triple-slash directive from normalizer.ts so tsc includes it in any
// program that type-checks normalizer.ts, even a consuming package's (whose
// own tsconfig `include` doesn't reach into this package's src/types).
interface NaturalStemmer {
	stem: (token: string) => string;
}

declare module "natural/lib/natural/stemmers/porter_stemmer.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_de.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_es.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_fr.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_it.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_nl.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}

declare module "natural/lib/natural/stemmers/porter_stemmer_pt.js" {
	const stemmer: NaturalStemmer;
	export default stemmer;
}
