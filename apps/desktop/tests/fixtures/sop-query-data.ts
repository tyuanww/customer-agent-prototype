import type { SopQueryResponse } from '../../src/shared/sop-query';

export function sopQueryData(requestId: string): Extract<SopQueryResponse,{status:'ready'}> {
  return {status:'ready',request_id:requestId,release_id:'rel_synthetic_sop',lease_expires_at:new Date(Date.now()+600_000).toISOString(),reasons:[],result:{
    entry_node_id:'check',
    nodes:[
      {node_id:'check',scenario_id:'synthetic',sequence:90,kind:'decision',terminal:false,source_ref:'synthetic:1'},
      {node_id:'reply',scenario_id:'synthetic',sequence:2,kind:'instruction',terminal:false,source_ref:'synthetic:2'},
      {node_id:'end',scenario_id:'synthetic',sequence:1,kind:'terminal',terminal:true,source_ref:'synthetic:3'},
    ],
    branches:[
      {branch_id:'yes',source_node_id:'check',option:'已确认',target_node_id:'reply',is_unresolved:false},
      {branch_id:'no',source_node_id:'check',option:'暂不继续',target_node_id:'end',is_unresolved:false},
      {branch_id:'done',source_node_id:'reply',option:'完成核对',target_node_id:'end',is_unresolved:false},
    ],
    messages:[
      {message_id:'reply-a',node_id:'reply',title:'合成话术甲',body:'这是合成原文甲。\n保留换行。',risk_level:'low',copy_allowed:true},
      {message_id:'reply-b',node_id:'reply',title:'合成话术乙',body:'这是合成原文乙。',risk_level:'high',copy_allowed:false},
    ],media_refs:[],
  }};
}
