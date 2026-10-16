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
  if (busy && signedIn) {
    caption = '处理中';
  } else if (signedIn) {
    caption = `${label} · 退出`;
  }
  return (
    <button
      type="button"
      className="capsule-session-entry"
      disabled={busy && signedIn}
      onClick={onClick}
      title={busy && !signedIn ? '登录还在等待。可以再次点击登录。' : title}
    >
      {caption}
    </button>
  );
}
