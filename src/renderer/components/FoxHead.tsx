import type { AnimationEventHandler } from 'react';
import type { FoxExpression } from '@shared/fox-presence';
import foxHeadUrl from '../../../fox-head.png';

export const FOX_SLEEP_POSE_SCALE_X = 1.06;
export const FOX_SLEEP_POSE_SCALE_Y = 0.82;

export const FOX_EYE_ROI = {
  minX: 24,
  maxX: 36,
  minY: 44.3,
  maxY: 52.2,
} as const;

export const FOX_CLOSED_LID = {
  leftX: 25.0,
  rightX: 34.4,
  lidY: 45.68,
  controlX: 29.7,
  controlY: 50.85,
  strokeWidth: 1.7,
  stemX: 29.7,
  stemStartY: 48.62,
  stemEndY: 51.82,
} as const;

export const FOX_DROWSY_LID = {
  leftX: 25.15,
  rightX: 34.25,
  lidY: 45.68,
  controlX: 29.7,
  controlY: 49.35,
  strokeWidth: 1.45,
  stemX: 29.7,
  stemStartY: 47.85,
  stemEndY: 50.95,
} as const;

export function quadraticArcDepth(startY: number, controlY: number): number {
  return Math.abs((startY + controlY) / 2 - startY);
}

export function measureClosedLidInSleepPose(lid = FOX_CLOSED_LID) {
  return {
    visibleWidth: (lid.rightX - lid.leftX) * FOX_SLEEP_POSE_SCALE_X,
    arcDepth: quadraticArcDepth(lid.lidY, lid.controlY) * FOX_SLEEP_POSE_SCALE_Y,
    strokeThickness: lid.strokeWidth * FOX_SLEEP_POSE_SCALE_Y,
    stemLength: (lid.stemEndY - lid.stemStartY) * FOX_SLEEP_POSE_SCALE_Y,
  };
}

type FoxHeadProps = {
  size?: number;
  glowing?: boolean;
  warning?: boolean;
  expression?: FoxExpression;
  headsetSignal?: boolean;
  className?: string;
  onAnimationEnd?: AnimationEventHandler<HTMLSpanElement>;
};

export function FoxHead({
  size = 64,
  glowing = false,
  warning = false,
  expression = 'none',
  headsetSignal = false,
  className = '',
  onAnimationEnd,
}: FoxHeadProps) {
  const expressionState = expression === 'none' ? 'awake' : expression;
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
      data-fox-expression={expression}
      data-fox-headset-signal={headsetSignal ? 'true' : 'false'}
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
      <svg
        className="fox-expression-layer"
        data-testid="fox-expression-layer"
        data-expression-state={expressionState}
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <rect
          className="fox-expression-cover"
          x="24.2"
          y="44.4"
          width="11"
          height="7.8"
          rx="1.05"
          fill="#F9D6C5"
        />
        <g
          className="fox-expression-mark is-awake"
          data-testid="fox-expression-awake"
          fill="#A45C4A"
          stroke="#A45C4A"
          strokeLinecap="round"
        />
        <g
          className="fox-expression-mark is-drowsy"
          data-testid="fox-expression-drowsy"
          fill="none"
          stroke="#A45C4A"
          strokeLinecap="round"
        >
          <path
            d={`M${FOX_DROWSY_LID.leftX} ${FOX_DROWSY_LID.lidY} Q${FOX_DROWSY_LID.controlX} ${FOX_DROWSY_LID.controlY} ${FOX_DROWSY_LID.rightX} ${FOX_DROWSY_LID.lidY}`}
            strokeWidth={FOX_DROWSY_LID.strokeWidth}
          />
          <path
            d={`M${FOX_DROWSY_LID.stemX} ${FOX_DROWSY_LID.stemStartY} L${FOX_DROWSY_LID.stemX} ${FOX_DROWSY_LID.stemEndY}`}
            strokeWidth="1.15"
          />
        </g>
        <g
          className="fox-expression-mark is-closed"
          data-testid="fox-expression-closed"
          fill="none"
          stroke="#A45C4A"
          strokeLinecap="round"
        >
          <path
            data-testid="fox-expression-closed-lid"
            d={`M${FOX_CLOSED_LID.leftX} ${FOX_CLOSED_LID.lidY} Q${FOX_CLOSED_LID.controlX} ${FOX_CLOSED_LID.controlY} ${FOX_CLOSED_LID.rightX} ${FOX_CLOSED_LID.lidY}`}
            strokeWidth={FOX_CLOSED_LID.strokeWidth}
          />
          <path
            data-testid="fox-expression-closed-stem"
            d={`M${FOX_CLOSED_LID.stemX} ${FOX_CLOSED_LID.stemStartY} L${FOX_CLOSED_LID.stemX} ${FOX_CLOSED_LID.stemEndY}`}
            strokeWidth="1.2"
          />
        </g>
        <g
          className="fox-expression-mark is-strained"
          data-testid="fox-expression-strained"
          fill="none"
          stroke="#A45C4A"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M25 45.8 L28.2 47.8 L25 49.8" />
          <path d="M34.4 45.8 L31.2 47.8 L34.4 49.8" />
        </g>
      </svg>
      {headsetSignal ? (
        <svg
          className="fox-headset-signal"
          data-testid="fox-headset-signal"
          viewBox="0 0 64 64"
          aria-hidden="true"
        >
          <g className="fox-headset-wave fox-headset-wave-left" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M5.8 31.8 Q2.4 35.6 5.8 39.4" strokeWidth="1.4" />
            <path d="M3.7 29.8 Q-1.1 35.6 3.7 41.4" strokeWidth="1.05" />
          </g>
          <g className="fox-headset-wave fox-headset-wave-right" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M58.2 31.8 Q61.6 35.6 58.2 39.4" strokeWidth="1.4" />
            <path d="M60.3 29.8 Q65.1 35.6 60.3 41.4" strokeWidth="1.05" />
          </g>
        </svg>
      ) : null}
    </span>
  );
}
