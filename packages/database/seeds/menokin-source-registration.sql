-- Menokin source names only. This is not a migration and does not import workbooks.
-- The format guard only accepts the frozen FAQ or CSV tuple. This uses the FAQ
-- tuple with mapping version not-imported. structure_digest is SHA-256 of the
-- UTF-8 marker menokin-source-not-imported, not a hash of any desktop workbook.
-- mode stays legacy, so v2-preview publish does not open.

BEGIN;

INSERT INTO content_intake.scopes (scope_id, tenant_id, app_id, brand_id, shop_id, domain)
VALUES
  ('scope-menokin-product', 'tenant-menokin', 'app-customer-agent', 'brand-menokin', 'shop-menokin', 'product'),
  ('scope-menokin-presale', 'tenant-menokin', 'app-customer-agent', 'brand-menokin', 'shop-menokin', 'presale'),
  ('scope-menokin-aftersale', 'tenant-menokin', 'app-customer-agent', 'brand-menokin', 'shop-menokin', 'aftersale'),
  ('scope-menokin-campaign', 'tenant-menokin', 'app-customer-agent', 'brand-menokin', 'shop-menokin', 'campaign')
ON CONFLICT (scope_id) DO NOTHING;

INSERT INTO content_intake.sources (source_id, scope_id, current_mapping_version, mode)
VALUES
  ('src-menokin-faq', 'scope-menokin-product', 1, 'legacy'),
  ('src-menokin-presale', 'scope-menokin-presale', 1, 'legacy'),
  ('src-menokin-aftersale', 'scope-menokin-aftersale', 1, 'legacy'),
  ('src-menokin-campaign', 'scope-menokin-campaign', 1, 'legacy')
ON CONFLICT (source_id) DO NOTHING;

INSERT INTO content_intake.source_mappings (source_id, version, template_version, rule_version, mapping_version, structure_digest)
VALUES
  ('src-menokin-faq', 1, 'faq-p1.1', 'intake-p1.1', 'not-imported', '4e042c857f9bb13d37496c5e1aad0d8cd3ca5f614bacf657e49f755555295024'),
  ('src-menokin-presale', 1, 'faq-p1.1', 'intake-p1.1', 'not-imported', '4e042c857f9bb13d37496c5e1aad0d8cd3ca5f614bacf657e49f755555295024'),
  ('src-menokin-aftersale', 1, 'faq-p1.1', 'intake-p1.1', 'not-imported', '4e042c857f9bb13d37496c5e1aad0d8cd3ca5f614bacf657e49f755555295024'),
  ('src-menokin-campaign', 1, 'faq-p1.1', 'intake-p1.1', 'not-imported', '4e042c857f9bb13d37496c5e1aad0d8cd3ca5f614bacf657e49f755555295024')
ON CONFLICT (source_id, version) DO NOTHING;

COMMIT;
