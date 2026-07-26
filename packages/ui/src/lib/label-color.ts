/**
 * A user-picked label color (RFC 030, issue #26). Unlike the app's status
 * tones (positive/warning/danger/…), a label's color carries no meaning the
 * design system assigns — the user picked it to tell their own labels apart —
 * so it renders from the literal Tailwind palette rather than a semantic
 * token.
 */
export type LabelColorValue =
	| "Default"
	| "Red"
	| "Orange"
	| "Yellow"
	| "Green"
	| "Teal"
	| "Blue"
	| "Purple"
	| "Gray";

/** Solid dot color for a label swatch or chip. */
export const labelDotClass: Record<LabelColorValue, string> = {
	Default: "bg-fg-subtle",
	Red: "bg-red-500",
	Orange: "bg-orange-500",
	Yellow: "bg-yellow-500",
	Green: "bg-green-500",
	Teal: "bg-teal-500",
	Blue: "bg-blue-500",
	Purple: "bg-purple-500",
	Gray: "bg-gray-500",
};

/** Every color a label can be assigned, in picker order. */
export const labelColorOptions: LabelColorValue[] = [
	"Default",
	"Red",
	"Orange",
	"Yellow",
	"Green",
	"Teal",
	"Blue",
	"Purple",
	"Gray",
];

export const isLabelColorValue = (value: string): value is LabelColorValue =>
	Object.hasOwn(labelDotClass, value);
