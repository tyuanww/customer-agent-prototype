type StatusBadgeProps = {
  label: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'mock';
};

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <span className={`dash-badge is-${tone}`}>
      <span className="dash-badge-mark" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
