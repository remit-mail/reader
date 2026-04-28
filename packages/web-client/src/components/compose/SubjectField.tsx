interface SubjectFieldProps {
	value: string;
	onChange: (value: string) => void;
}

export const SubjectField = ({ value, onChange }: SubjectFieldProps) => (
	<div className="flex items-start gap-2">
		<label className="text-sm text-muted-foreground shrink-0 w-12 pt-1.5">
			Subj:
		</label>
		<input
			type="text"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="flex-1 px-2 py-1.5 border rounded-md bg-background text-sm"
			placeholder="Subject"
			data-subject-field
		/>
	</div>
);
