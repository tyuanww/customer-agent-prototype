import type { AnimationEventHandler } from 'react';
import foxHeadUrl from '../../../fox-head.png';

type FoxHeadProps = {
  size?: number;
  glowing?: boolean;
  warning?: boolean;
  className?: string;
  onAnimationEnd?: AnimationEventHandler<HTMLSpanElement>;
};

export function FoxHead({
  size = 64,
  glowing = false,
  warning = false,
  className = '',
  onAnimationEnd,
}: FoxHeadProps) {
  const resolvedClassName = [
    'fox-head',
    glowing ? 'is-glowing' : '',
    warning ? 'is-warning' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={resolvedClassName}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onAnimationEnd={onAnimationEnd}
    >
      <img
        className="fox-head-image"
        src={foxHeadUrl}
        alt=""
        draggable={false}
        width={1254}
        height={1254}
      />
    </span>
  );
}
