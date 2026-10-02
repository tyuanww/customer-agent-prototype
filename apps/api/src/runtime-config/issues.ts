/**
 * Shared vocabulary for configuration rejection.
 *
 * Every config group records problems as frozen field/reason pairs and rejects
 * empty or padded environment values the same way. The cross-field owner in
 * runtime-config.ts decides which groups run and which combinations are legal.
 *
 * Stays in apps/api. The reason codes are this service's startup contract.
 */

export type ApiRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type ApiConfigIssue = Readonly<{
  field: string;
  reason:
    | 'missing'
    | 'invalid'
    | 'profile_not_service'
    | 'profile_not_available'
    | 'auth_mode_not_available'
    | 'external_bind_not_allowed';
}>;

export function issue(field: string, reason: ApiConfigIssue['reason']): ApiConfigIssue {
  return Object.freeze({ field, reason });
}

export function exactEnvironmentValue(
  environment: ApiRuntimeEnvironment,
  field: string,
  issues: ApiConfigIssue[],
): string | undefined {
  const value = environment[field];
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0 || value.trim() !== value) {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  return value;
}
