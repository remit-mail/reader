import { Star, X } from "lucide-react";
import {
	COMPOSE_LANGUAGE_OPTIONS,
	languageLabel,
	primaryLanguageSubtag,
} from "../lib/compose-language.js";
import { Button } from "./button.js";

export interface ComposeLanguageSettingProps {
	/** The account's tags, most-used first. The first is the compose default. */
	value: readonly string[];
	onChange: (languages: string[]) => void;
	busy?: boolean;
}

const addable = (chosen: readonly string[]): string[] => {
	const taken = new Set(chosen.map(primaryLanguageSubtag));
	return COMPOSE_LANGUAGE_OPTIONS.map((option) => option.tag)
		.filter((tag) => !taken.has(tag))
		.sort((left, right) =>
			languageLabel(left).localeCompare(languageLabel(right)),
		);
};

/**
 * The account's writing languages. The list is two things at once: the menu the
 * composer's language chip offers, and the set detection is allowed to choose
 * inside — which is what keeps detection accurate on one sentence. The first
 * entry is what a new message opens on.
 */
export const ComposeLanguageSetting = ({
	value,
	onChange,
	busy = false,
}: ComposeLanguageSettingProps) => {
	const options = addable(value);

	return (
		<div className="space-y-2" data-testid="compose-language-setting">
			<ul className="space-y-1">
				{value.map((tag, index) => (
					<li
						key={tag}
						data-testid={`compose-language-row-${tag}`}
						className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-1.5"
					>
						<span
							className="min-w-0 flex-1 truncate text-sm text-fg"
							lang={tag}
						>
							{languageLabel(tag)}
						</span>
						{index === 0 ? (
							<span className="shrink-0 text-2xs uppercase tracking-wider text-fg-subtle">
								Default
							</span>
						) : (
							<Button
								variant="ghost"
								size="sm"
								icon={<Star className="size-3.5" />}
								disabled={busy}
								aria-label={`Write new messages in ${languageLabel(tag)} by default`}
								onClick={() =>
									onChange([tag, ...value.filter((other) => other !== tag)])
								}
							>
								Default
							</Button>
						)}
						<Button
							variant="ghost"
							size="sm"
							icon={<X className="size-3.5" />}
							disabled={busy || value.length === 1}
							aria-label={`Remove ${languageLabel(tag)}`}
							onClick={() => onChange(value.filter((other) => other !== tag))}
						/>
					</li>
				))}
			</ul>
			<select
				aria-label="Add a language"
				value=""
				disabled={busy || options.length === 0}
				onChange={(event) => {
					if (event.target.value === "") return;
					onChange([...value, event.target.value]);
				}}
				className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg outline-none transition-colors focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30"
			>
				<option value="">Add a language…</option>
				{options.map((tag) => (
					<option key={tag} value={tag}>
						{languageLabel(tag)}
					</option>
				))}
			</select>
			<p className="text-xs text-fg-muted">
				A message is tagged with the language you write it in, picked from this
				list. Your browser, not this app, decides which dictionaries it
				spellchecks against — add the language there too to get its underlines.
			</p>
		</div>
	);
};
