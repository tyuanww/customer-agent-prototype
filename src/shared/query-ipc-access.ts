import type { RendererRole } from './overlay-events';

export function isTrustedQuerySender(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return input.trusted && input.role === 'query';
}

export function canReportUiPhase(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return isTrustedQuerySender(input);
}

export function canCopyText(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return isTrustedQuerySender(input);
}

export function canReportQueryLayout(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return isTrustedQuerySender(input);
}

export function canResizeQueryHeight(input: {
  trusted: boolean;
  role: RendererRole | null;
}): boolean {
  return isTrustedQuerySender(input);
}
