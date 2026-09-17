import type { OverlayRole, RendererRole } from './overlay-events';

export function canQueryOpenSop(input: {
  trusted: boolean;
  role: OverlayRole | RendererRole | null;
}): boolean {
  return input.trusted && input.role === 'query';
}

export function canQueryReadSopEntry(input: {
  trusted: boolean;
  role: OverlayRole | RendererRole | null;
}): boolean {
  return canQueryOpenSop(input);
}

export function canControlSopWindow(input: {
  trustedSop: boolean;
}): boolean {
  return input.trustedSop;
}
