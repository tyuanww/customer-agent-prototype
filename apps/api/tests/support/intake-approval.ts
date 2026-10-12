import { reviewForm, type ApprovalTransport } from '../../src/content-intake/approval-adapter.js';

export type SyntheticInstance = {
  tenantId: string; appId: string; definitionId: string; nodeId: string; createUuid: string; instanceCode: string;
  form: ReturnType<typeof reviewForm>; attachmentFileCode: string; state: string;
  task: null | { taskId: string; nodeId: string; kind: string; status: string; identityScope: string; personKey: string; endTime: string };
  timeline: { type: string; taskId: string; identityScope: string; personKey: string; time: string }[];
};

/** In-process synthetic provider. Stores a separate byte copy as a real attachment
 * consumer, deduplicates creation by UUID, and never contacts Feishu or reads credentials. */
export function syntheticApproval() {
  const instances = new Map<string,SyntheticInstance>();
  const packages = new Map<string,Buffer>();
  let calls = 0;
  let instanceCalls = 0;
  const transport: ApprovalTransport = {
    async create(b,bytes) {
      calls++;
      let instance = instances.get(b.createUuid);
      if (!instance) {
        instance = { tenantId:b.tenantId,appId:b.appId,definitionId:b.definitionId,nodeId:b.nodeId,createUuid:b.createUuid,
          instanceCode:`instance-${b.createUuid}`,form:reviewForm(b),attachmentFileCode:`file-${b.createUuid}`,state:'PENDING',task:null,timeline:[] };
        instances.set(b.createUuid,structuredClone(instance));
        packages.set(instance.attachmentFileCode,Buffer.from(bytes));
      }
      return { instanceCode:instance.instanceCode,attachmentFileCode:instance.attachmentFileCode };
    },
    async instance(b) { instanceCalls++; return structuredClone(instances.get(b.createUuid)); },
    async *attachment(code) {
      const bytes = packages.get(code);
      if (!bytes) throw new Error('synthetic attachment missing');
      const midpoint = Math.floor(bytes.length/2);
      yield bytes.subarray(0,midpoint); yield bytes.subarray(midpoint);
    },
  };
  function latest(): SyntheticInstance { return [...instances.values()].at(-1)!; }
  function approve(personKey: string, at = new Date().toISOString(), instance = latest()): void {
    const taskId = `task-${instance.createUuid}`;
    instance.state='APPROVED';
    instance.task={ taskId,nodeId:instance.nodeId,kind:'HUMAN',status:'APPROVED',identityScope:'confirmed-synthetic',personKey,endTime:at };
    instance.timeline=[{ type:'PASS',taskId,identityScope:'confirmed-synthetic',personKey,time:at }];
  }
  return { transport,instances,packages,latest,approve,calls:() => calls,instanceCalls:() => instanceCalls };
}
