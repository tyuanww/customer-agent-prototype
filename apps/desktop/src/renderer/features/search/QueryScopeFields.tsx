type PlaceholderKey = 'order_id' | 'date';

type QueryScopeFieldsProps = {
  keys: readonly PlaceholderKey[];
  values: Partial<Record<PlaceholderKey, string>>;
  disabled: boolean;
  onChange: (key: PlaceholderKey, value: string) => void;
};

function placeholderLabel(key: PlaceholderKey): string {
  if (key === 'order_id') {
    return '订单号';
  }
  return '日期';
}

export function QueryScopeFields({
  keys,
  values,
  disabled,
  onChange,
}: QueryScopeFieldsProps) {
  return (
    <fieldset aria-label="查询范围" className="product-query-context">
      <legend>查询范围</legend>
      {keys.map((key) => (
        <label key={key}>
          {placeholderLabel(key)}
          <input
            disabled={disabled}
            aria-label={placeholderLabel(key)}
            value={values[key] ?? ''}
            onChange={(event) => onChange(key, event.target.value)}
          />
        </label>
      ))}
    </fieldset>
  );
}
