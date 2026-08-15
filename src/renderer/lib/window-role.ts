import { isRendererRole, type RendererRole } from '@shared/overlay-events';

export function readRoleFromLocation(search: string = window.location.search): RendererRole {
  const params = new URLSearchParams(search);
  const role = params.get('role');
  return isRendererRole(role) ? role : 'query';
}
