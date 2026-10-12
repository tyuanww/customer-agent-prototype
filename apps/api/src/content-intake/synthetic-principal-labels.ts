/** Display names for the isolated test identities. Unknown people stay unlabeled
 * so the directory fails closed instead of inventing a name. */
const SYNTHETIC_PRINCIPAL_LABELS: Readonly<Record<string, string>> = {
  synthetic_owner: '测试总监',
  synthetic_coach: '测试整理人',
  synthetic_agent: '测试坐席',
  synthetic_quality: '测试质检',
};

export function syntheticPrincipalLabels(identity: Readonly<{
  principalId: string; tenantId: string; appId: string;
}>): string | null {
  if (identity.tenantId !== 'tenant-menokin' || identity.appId !== 'app-customer-agent') return null;
  return SYNTHETIC_PRINCIPAL_LABELS[identity.principalId] ?? null;
}
