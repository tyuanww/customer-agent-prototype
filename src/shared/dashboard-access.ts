import type { RendererRole } from './overlay-events';

export function canOpenDashboard(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return input.trusted && input.role === 'query';
}
