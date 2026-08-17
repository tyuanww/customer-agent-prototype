import foxHeadUrl from '../../../fox-head.png';
import darkFoxHeadUrl from '../assets/dashboard-fox-headset-dark.png';

type DashboardBrandFoxProps = {
  theme: 'light' | 'dark';
  size?: number;
};

export function DashboardBrandFox({ theme, size = 40 }: DashboardBrandFoxProps) {
  const activeVariant = theme === 'dark' ? 'white-headset' : 'purple-headset';
  const activeImageUrl = theme === 'dark' ? darkFoxHeadUrl : foxHeadUrl;

  return (
    <span
      className="dashboard-brand-fox"
      style={{ width: size, height: size }}
      data-active-variant={activeVariant}
      aria-hidden="true"
    >
      <img
        className={`dashboard-brand-fox-image is-${activeVariant}`}
        src={activeImageUrl}
        alt=""
        draggable={false}
        width={1254}
        height={1254}
        data-active="true"
      />
    </span>
  );
}
