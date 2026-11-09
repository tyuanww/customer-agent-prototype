import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import { createTemplate, parseWorkbook } from '@customer-agent/content-intake';
import { canonical, digest, materialFromParse } from '../../dist/content-intake/material.js';
import { seedIntakeSyntheticHost } from './intake-synthetic-seed.ts';

/** Synthetic persisted facts, not the production graph importer or publisher. */
export async function seedSopQuerySource(admin: Client) {
  await seedIntakeSyntheticHost(admin);
  await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
    VALUES ('menokin-sop','scope-a',1,'v2-preview');
    INSERT INTO content_intake.source_mappings VALUES ('menokin-sop',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64));
    INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
      VALUES ('tenant-a','app-a',1,'scope-a','menokin-sop',clock_timestamp()+interval '2 hours');
    INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
      to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-graph','source_id','menokin-sop'))).*
      FROM content_intake.grants g WHERE source_id='source-a' AND kind='business'`);
}

export async function seedSopQueryGraph(admin: Client, options: { id?: string; annotations?: boolean; media?: boolean; unsafe?: boolean; risk?: string; sequence?: number; ambiguous?: boolean; fault?: 'unresolved-target' | 'terminal-outgoing' | 'cycle' } = {}) {
  const id = options.id ?? 'graph-one';
  const context = { sourceId: 'menokin-sop', brandId: 'brand-a', scope: 'shop-a', scopeKind: 'shop' as const,
    domain: 'product' as const, sheet: 'FAQ' as const, templateVersion: 'faq-p1.1' as const };
  const body = '合成过敏情况请先停手，再确认情况。';
  const bytes = await createTemplate(context, [['entry-a','合成步骤',body,'','','合成分类','','启用','','','','内部说明','','','false']]);
  const parsed = await parseWorkbook(bytes, context);
  const object = { objectId: `object-${id}`, sha256: digest(bytes), bytes: bytes.length,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const, sourceId: 'menokin-sop' };
  const material = materialFromParse({ parsed, source: { scopeId: 'scope-a', scope: { tenantId:'tenant-a',appId:'app-a',
    brandId:'brand-a',shopId:'shop-a',domain:'product',sourceId:'menokin-sop' }, version:1,templateVersion:'faq-p1.1',ruleVersion:'intake-p1.1',
    mappingVersion:'mapping-p1.1',structureDigest:'a'.repeat(64),mode:'v2-preview' }, object,
    contributors:['enabler'],previous:[],terms:[],baseReleaseId:'rel_native_base',now:Date.now()-1000,recentDisables:0 });
  const entry = { ...material.entries[0]!, answerText: body };
  const key = { sourceId:'menokin-sop',flowId:'allergy',flowVersion:1 };
  const defaultGraph = { definition: { header: { key,title:'合成过敏流程',anchorEntry:{sourceId:'menokin-sop',businessEntryId:'entry-a',scriptVersion:1},
    entryTerms:['合成过敏','synthetic allergy'],startNodeId:'start',operation:'upsert' },
    nodes:[{key,id:'start',body:{kind:'message',entry:{sourceId:'menokin-sop',businessEntryId:'entry-a',scriptVersion:1}}},
      {key,id:'end',body:{kind:'end',text:'合成流程结束。'}}],
    edges:[{key,id:'next',from:'start',to:'end',action:{kind:'next'}}] },
    entries:[{sourceId:'menokin-sop',entry}],media:options.media ? [{objectId:'missing-image'}] : [] };
  // Corrupt persisted graph facts exercise the query boundary without invalidating FAQ lineage first.
  if (options.unsafe) defaultGraph.definition.nodes[1]!.body.text = '合成过敏情况。';
  if (options.fault === 'unresolved-target') defaultGraph.definition.edges[0]!.to = 'missing';
  if (options.fault === 'terminal-outgoing' || options.fault === 'cycle') {
    defaultGraph.definition.edges.push({ key, id:'return', from:'end', to:'start', action:{kind:'next'} });
    if (options.fault === 'cycle') defaultGraph.definition.nodes[1]!.body.kind = 'internal';
  }
  const graph = options.ambiguous ? {
    definition:{header:{...defaultGraph.definition.header,entryTerms:['合成判断']},
      nodes:[{key,id:'start',body:{kind:'decision',text:'合成判断。'}},
        {key,id:'end',body:{kind:'end',text:'合成结束甲。'}}, {key,id:'other',body:{kind:'end',text:'合成结束乙。'}}],
      edges:[{key,id:'next',from:'start',to:'end',action:{kind:'choice',label:'选择甲',ordinal:1,matchTerms:['合成歧义']}},
        {key,id:'other-choice',from:'start',to:'other',action:{kind:'choice',label:'选择乙',ordinal:2,matchTerms:['合成歧义']}}]},
    entries:defaultGraph.entries,media:[],
  } : defaultGraph;
  const graphCanonical = canonical(graph);
  await admin.query('BEGIN');
  try {
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES($1,'menokin-sop','enabler','tenant-a','app-a',$2,$3,$4,$5,'input',clock_timestamp())`,
    [object.objectId,`intake/synthetic/${id}`,object.sha256,object.bytes,object.mime]);
    await admin.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,
      actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,state,source_evidence_version,
      approval_evidence_version,created_at,updated_at) VALUES($1,1,'menokin-sop','scope-a',1,$2,$3,'enabler','rel_native_base',
      'candidate-p1.1',$4,$5,'routine',0,'awaiting-evidence',0,0,clock_timestamp(),clock_timestamp())`,
    [id,object.objectId,object.sha256,canonical(material),material]);
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES($1,'menokin-sop','enabler','tenant-a','app-a',$2,$3,10,'application/json','review-package',clock_timestamp())`,
      [`package-${id}`,`intake/synthetic/package-${id}`,object.sha256]);
    await admin.query(`INSERT INTO content_intake.source_confirmations VALUES($1,1,$2,'menokin-sop',1,0,'opaque','synthetic-v1',
      'controlled-synthetic-export','enabler',clock_timestamp(),$3)`,[id,digest(canonical(material)),object.sha256]);
    await admin.query(`INSERT INTO content_intake.review_bindings(review_request_id,candidate_id,candidate_version,candidate_digest,
      evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,package_object_id,package_sha256,instance_code,attachment_file_code)
      VALUES($1,$2,1,$3,1,'tenant-a','app-a','synthetic-definition','synthetic-review',$4,$5,$6,$1,'synthetic-attachment')`,
    [`review-${id}`,id,digest(canonical(material)),randomUUID(),`package-${id}`,object.sha256]);
    await admin.query(`INSERT INTO content_intake.approval_facts VALUES($1,1,0,'approved',clock_timestamp(),clock_timestamp()+interval '299 seconds',
      repeat('a',64),$2,'synthetic-task','reviewer',1,clock_timestamp()-interval '1 second')`,[`review-${id}`,object.sha256]);
    await admin.query('INSERT INTO content_intake.approval_current VALUES($1,1)',[`review-${id}`]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='ready',source_evidence_version=1,approval_evidence_version=1 WHERE candidate_id=$1",[id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='publishing' WHERE candidate_id=$1",[id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='published' WHERE candidate_id=$1",[id]);
    await admin.query(`INSERT INTO content_intake.sop_graph_versions(candidate_id,candidate_version,material_digest,source_id,flow_id,flow_version,
      operation,canonical_graph,graph_payload) VALUES($1,1,$2,'menokin-sop','allergy',1,'upsert',$3,$4)`,
    [id,digest(canonical(material)),graphCanonical,graph]);
    await admin.query(`INSERT INTO content_intake.sop_graph_quality_targets VALUES($1,1,$2,'menokin-sop','allergy',1,$3,'sop-graph-quality-v1');
      `,[id,digest(canonical(material)),digest(graphCanonical)]);
    await admin.query(`INSERT INTO content_intake.sop_graph_quality_checks VALUES($1,1,'menokin-sop','allergy',1,$2,'initial','reviewer',false,'',clock_timestamp())`,
    [id,digest(graphCanonical)]);
    if (options.annotations !== false) await admin.query(`INSERT INTO content_intake.sop_query_annotations VALUES($1,1,'menokin-sop','allergy',1,$2,$3,$4)`,
      [id,digest(graphCanonical),JSON.stringify([
        {node_id:'start',title:'合成判断',sequence:options.sequence ?? 1,source_ref:'synthetic:FAQ!A2',message_id:'message-start',risk_level:options.risk ?? 'high',copy_allowed:!options.ambiguous},
        {node_id:'end',sequence:2,source_ref:'synthetic:流程!A3',title:'合成终止',message_id:'message-end',risk_level:'low',copy_allowed:false},
        ...(options.ambiguous ? [{node_id:'other',sequence:3,source_ref:'synthetic:流程!A4',title:'合成结束乙',message_id:'message-other',risk_level:'low',copy_allowed:false}] : []),
      ]),JSON.stringify(options.ambiguous ? [{branch_id:'next',option:'选择甲'},{branch_id:'other-choice',option:'选择乙'}]
        : [{branch_id:'next',option:'继续'}, ...(options.fault === 'terminal-outgoing' || options.fault === 'cycle' ? [{branch_id:'return',option:'返回'}] : [])])]);
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
  return { id, graphDigest:digest(graphCanonical), object, graph };
}

/** Mimics a committed release's normalized lineage. Does not claim publish API coverage. */
export async function seedSopQueryRelease(admin: Client, graph: { id:string; graphDigest:string }, releaseId: string) {
  await admin.query('BEGIN');
  try {
    await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      SELECT $1,nextval('public.content_release_seq'),'合成图发布','published',source_binding_hash,tenant_id
      FROM public.content_releases WHERE release_id='rel_native_base'`,[releaseId]);
    await admin.query(`INSERT INTO public.release_source_bindings SELECT $1,domain,source_version_id FROM public.release_source_bindings WHERE release_id='rel_native_base'`,[releaseId]);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES($1,'intake-v2.1')",[releaseId]);
    await admin.query(`INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until)
      VALUES($1,'menokin-sop','entry-a',1,$2,1,$3,clock_timestamp()+interval '1 day')`,[releaseId,graph.id,`review-${graph.id}`]);
    await admin.query(`INSERT INTO content_intake.sop_graph_release_lineage VALUES($1,'menokin-sop','allergy',1,$2,$3,1,$4)`,
      [releaseId,graph.graphDigest,graph.id,`review-${graph.id}`]);
    await admin.query('UPDATE public.content_current SET current_release_id=$1 WHERE id=1',[releaseId]);
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
}

export const syntheticSessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
