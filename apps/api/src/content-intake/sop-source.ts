/** A workbook is parsed as SOP only when the source is the SOP registration.
 * The consumed response schema still omits domain sop, so the synthetic fixture
 * opts in with mapping version sop-not-imported while its domain stays product.
 * The registered Menokin source matches the first three checks. */
export function sourceUsesSopWorkbook(source: {
  scope: { domain: string };
  templateVersion: string;
  ruleVersion: string;
  mappingVersion: string;
}): boolean {
  const domain: string = source.scope.domain;
  return domain === 'sop'
    || source.templateVersion === 'sop-v1'
    || source.ruleVersion === 'sop-not-imported'
    || source.mappingVersion === 'sop-not-imported';
}
