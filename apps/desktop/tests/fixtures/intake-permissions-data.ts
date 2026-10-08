import type { components } from '@customer-agent/contracts';
import type { IntakeUsageSession } from '../../src/main/content-intake-usage';
import { ProductHttpError } from '../../src/main/product-http';
type C=components['schemas'];
export function intakePermissionsData() {
 const until=new Date(Date.now()+60000).toISOString();
 const scope:C['IntakeSourceScope']={tenantId:'tenant-a',appId:'app-a',brandId:'brand-a',shopId:'shop-a',sourceId:'source-a',domain:'product'};
 const source:C['IntakeSource']={scope,version:1,templateVersion:'faq-p1.1',ruleVersion:'rule-1',mappingVersion:'mapping-1',structureDigest:'a'.repeat(64),contentIntakeMode:'v2-preview',modeVersion:1};
 const person:C['IntakePrincipalPage']['items'][number]={principalId:'registered-agent',displayLabel:'合成坐席',factsVersion:1,validUntil:until,enabled:true};
 let signedIn=true,epoch=1,unknown=false,omitPerson=false;
 const listeners=new Set<()=>void>(),requests:{path:string;body:unknown}[]=[];
 const grants:C['IntakeGrant'][]=[];const receipts=new Map<string,unknown>();
 const session:IntakeUsageSession={view:()=>({signedIn,sessionEpoch:epoch}),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  request:async(_epoch,path,options)=>{
   requests.push({path,body:options.body});let value:unknown;
   if(path.startsWith('/v1/intake/authorization'))value={factsVersion:1,revocationGeneration:0,policyVersion:1,validUntil:until,
    capabilities:[{scope,actions:[],mayAllocate:['query'],mayDelegate:[],validUntil:until}],nextCursor:null};
   else if(path.startsWith('/v1/intake/sources?'))value={items:[source],nextCursor:null};
   else if(path.startsWith('/v1/intake/principals?'))value={items:omitPerson?[]:[person],nextCursor:null};
   else if(path==='/v1/intake/grants/preview' || (path==='/v1/intake/grants' && options.body)){
    const batch=options.body as C['IntakeGrantBatch'];const item=batch.items[0]!;
    value=receipts.get(batch.operationId)??{items:[{grantId:'created-business',version:1,kind:'business',issuerPrincipalId:'registered-director',
     recipientPrincipalId:item.recipientPrincipalId,action:item.action,scope:item.scope,startsAt:item.startsAt,expiresAt:item.expiresAt,revokedAt:null,
     stewardPrincipalId:'registered-director',reason:item.reason,mayRedelegate:false,lastChangeReason:null}],nextCursor:null};
    if(path==='/v1/intake/grants'){if(!receipts.has(batch.operationId)){receipts.set(batch.operationId,value);grants.push(...(value as C['IntakeGrantList']).items);}
     if(unknown){unknown=false;throw new ProductHttpError('UNAVAILABLE');}}
   }else if(path.startsWith('/v1/intake/grants/created-business')){
    const change=options.body as C['IntakeGrantChange'];const g=grants[0]!;
    value=receipts.get(change.operationId)??{...g,version:2,revokedAt:new Date().toISOString(),lastChangeReason:change.reason,stewardPrincipalId:null};
    receipts.set(change.operationId,value);grants[0]=value as C['IntakeGrant'];
   }else if(path.startsWith('/v1/intake/grants?'))value={items:grants,nextCursor:null};
   else throw new Error(`unexpected path ${path}`);
   return {status:200,value:structuredClone(value)};
  }};
 return {session,person,requests,grants,receipts,until,scope,setUnknown:()=>{unknown=true;},hidePerson:()=>{omitPerson=true;},
  logout:()=>{signedIn=false;epoch++;listeners.forEach(fn=>fn());},
  command:(person:string)=>({action:'preview' as const,person,actions:['query' as const],startsAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),reason:'合成授予'})};
}
