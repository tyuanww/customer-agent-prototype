-- DRAFT schema.v1.29; requires the exact installed 0001–0040 closure and caller-owned transaction.
-- No receipt is issued here. The future approved migration runner owns install/receipt/COMMIT.
DO $readiness$ BEGIN
  IF (SELECT count(*) FROM customer_agent_meta.schema_migrations) <> 40 OR EXISTS (
    SELECT 1 FROM (VALUES (1,'0001_extensions','4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62'),
(2,'0002_identity_and_content','62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64'),
(3,'0003_events_and_metrics','c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4'),
(4,'0004_import_release_announce','ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a'),
(5,'0005_idempotency_rate_limit_outbox','715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02'),
(6,'0006_definer_functions_and_triggers','f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca'),
(7,'0007_search_bigram','7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189'),
(8,'0008_runtime_acl','f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2'),
(9,'0009_phase1_policy_seed','a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e'),
(10,'0010_search_projection_v1_13','026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818'),
(11,'0011_search_no_hit_context_v1_14','8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f'),
(12,'0012_owner_acceptance_v1_15','3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18'),
(13,'0013_backend_identity_content_v1_16','8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2'),
(14,'0014_release_deferred_guard_v1_17','ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339'),
(15,'0015_ops_loop_v1_18','e7ac1d9c5f487336b63ed4a8abeb66031dbcd3189286fbd2d07b97407685613b'),
(16,'0016_office_owner_publish','d574ebd891e3a7db771e6f6a5fb7a85f6e6d3614c7880f2dea4b4bb642d6b447'),
(17,'0017_rollback_previous_target','eb3ccbf3f04c4005393fc757b8f1e03d55a5078837b2b8eb9dbac72d83116788'),
(18,'0018_owner_read_views','c89d76992850aa562a3d24618bccb39a941a8bc88136342505a9edea5440acba'),
(19,'0019_candidate_client_snapshot','e4720feabd0a9b92d8d5cc22fcb6dcce75cf6e8136c0b2d9365d0d7c1cf18cd7'),
(20,'0020_coach_publish_v1_19','fd261530461c20aca90c5468997a695d67921fe53ff74b39de2c0a5f6b80d678'),
(21,'0021_content_intake_v1_20','7c19bf3f97fecb5af61c92131c0ce2a5f5f42822d2e104bb4202d96e292c73db'),
(22,'0022_intake_legacy_fence','8df4f9127362aa49c320b87d7afffd910312d54fab7193224e3bece5993a8b03'),
(23,'0023_intake_quality','c3b37131c28b76b2453e24d5f432e70329c478a7f90d34c95598518124e50136'),
(24,'0024_intake_publication','9b3b1d0ae32f0fc6e0f333428ac52c2e688c57aad1e610bbb6bb7c94e4d13af2'),
(25,'0025_intake_usage_v1_21','f270f787323a65baf3727337dcc34c1ff3f7a0bac0baf79a1894a7f7ae9591f4'),
(26,'0026_intake_discovery_index','c96e289e3ae19d600913b80796f3051eb7c19c5f544e1b8b9e17d5f5f1cd911f'),
(27,'0027_intake_rollback','da90dd3eaa366037fbbe71f4296697fdf3f9f788954119731926e6500df55e98'),
(28,'0028_intake_family','8b241e1b5f808c2278b53351a0d3cbee56f4ac23ca16c65736ba45ace859382e'),
(29,'0029_intake_capacity','9d56a3ea4b56d5ec1ccbef5bc331c12f5f788da725a2d09030f2ccbe9e2f00ab'),
(30,'0030_intake_role_ceiling','8843955f79d970bdc5f03469a7bba316c2f1fb8fa070d2b0f61ba9bc1f5144a3'),
(31,'0031_intake_direct_v1_22','82407ae1c0ce3a3dc975b9b5fe76012b5ab4f19ee5952dafb912a23509c4dcc0'),
(32,'0032_intake_direct_publication','38e72eb66941256861aeb3edddc609cdbbfbc4e1eed56366b370526ad82cbddc'),
(33,'0033_intake_runtime_v1_23','0cbc24c3f6ffbe877c6cd5f3f55fdf71a9af67aac069e04c4544bde74f463e1b'),
(34,'0034_intake_csv_v1_24','2f2e8963c461b0a3d720d5dbc42734851779a073bf71b07bc37d0c335416f31a'),
(35,'0035_intake_legacy_check_acl_v1_25','01a674d1f5a996a511babf193c28c217ec91a72a3f974922e9580cf2bcdabda7'),
(36,'0036_intake_sop_v1_26','1fc9f95dc3c14d743f52515195cf9597820826cf57c2f3c2cfea9bc19746f84d'),
(37,'0037_menokin_source_registration','93fc05c58af3001deb9fa4ce3645b6e3b2a784b220fec9db599fec2becfd8608'),
(38,'0038_menokin_sop_domain_v1_27','1ffdd633c2214eac2dc3ba306d7c905f68e95f7258d6f8cc250db72d85712a5b'),
(39,'0039_menokin_sop_stage_media','637fdbb4f96457361f17e6262eb69c4ae645f5b6745b08353474caad2696aba8'),
(40,'0040_intake_repair_successor_v1_28','ad333807d3c06140040944a4105cdaae74ba4e04af558befae54dcf2e2ea543a')) expected(position,id,hash)
    LEFT JOIN customer_agent_meta.schema_migrations actual ON actual.position=expected.position
    WHERE actual.migration_id IS DISTINCT FROM expected.id OR actual.migration_sha256 IS DISTINCT FROM expected.hash
  ) THEN RAISE EXCEPTION 'READINESS_PREDECESSOR_RECEIPTS_MISMATCH'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('intake_business','intake_worker','intake_runtime_fn_owner')
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) <> 3 THEN
    RAISE EXCEPTION 'READINESS_ROLE_BOUNDARY_MISMATCH'; END IF;
END $readiness$;
REVOKE ALL ON FUNCTION content_intake.candidate_format_guard(),
  content_intake.input_format_matches(text,text,text,text,text),
  content_intake.input_object_format_guard(),
  content_intake.parse_format_guard(),
  content_intake.source_format_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.input_format_matches(text,text,text,text,text)
  TO intake_business, intake_worker, intake_runtime_fn_owner;
COMMENT ON SCHEMA public IS 'CS-AI-C11 schema.v1.29; content-intake readiness successor; runtime activation and production NOT_CERTIFIED';
