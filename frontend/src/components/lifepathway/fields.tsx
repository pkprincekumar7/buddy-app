import { FIELD_STYLE, FIELD_LABEL_STYLE } from './theme';

/** A single-column labeled input — the shape shared by most text fields
 * across every step. */
export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id}>
      <span style={FIELD_LABEL_STYLE}>{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={FIELD_STYLE}
      />
    </label>
  );
}

/** Same shape as TextField, but a resizable textarea for longer answers. */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label htmlFor={id}>
      <span style={FIELD_LABEL_STYLE}>{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ ...FIELD_STYLE, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
      />
    </label>
  );
}
