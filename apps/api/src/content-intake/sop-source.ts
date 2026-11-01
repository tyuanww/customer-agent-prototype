/** The legacy row parser is available only to the explicit synthetic fixture.
 * A real `domain=sop` source must wait for the graph contract and must never
 * enter the FAQ-shaped parser as an accidental downgrade. */
export function sourceUsesSopWorkbook(source: {
  scope: { domain: string };
  templateVersion: string;
  ruleVersion: string;
  mappingVersion: string;
}): boolean {
  const domain: string = source.scope.domain;
  return domain !== 'sop' && source.mappingVersion === 'sop-not-imported';
}
