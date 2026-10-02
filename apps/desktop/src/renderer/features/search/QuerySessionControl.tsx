type QuerySessionControlProps = {
  busy: boolean;
  signedIn: boolean;
  label: string;
  title: string;
  unsignedLabel: string;
  onClick: () => void;
};

export function QuerySessionControl({
  busy,
  signedIn,
  label,
  title,
  unsignedLabel,
  onClick,
}: QuerySessionControlProps) {
  let caption = unsignedLabel;
  if (busy) {
    caption = '处理中';
  } else if (signedIn) {
    caption = `${label} · 退出`;
  }
  return (
    <button
      type="button"
      className="capsule-session-entry"
      disabled={busy}
      onClick={onClick}
      title={title}
    >
      {caption}
    </button>
  );
}
