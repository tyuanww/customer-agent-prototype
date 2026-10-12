import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/** Loopback fixture only. It never dials out and is not a Feishu client. */
export type SyntheticContactUser = {
  open_id: string; name: string; job_title?: string; department_ids: string[];
  status: { is_activated: boolean; is_frozen: boolean; is_resigned: boolean; is_exited: boolean; is_unjoin: boolean };
  is_tenant_manager?: boolean; email?: string;
};
export type SyntheticJob = { job_title_id: string; name: string; status: boolean };
export type SyntheticJobPage = { items: SyntheticJob[]; has_more: boolean; page_token?: string };
export type SyntheticContactRequest = { method: string; url: string; authorization: string };
export type SyntheticContactMode = { kind: 'native' }
  | { kind: 'status'; status: number; body: string }
  | { kind: 'hang' }
  | { kind: 'destroy' }
  | { kind: 'redirect'; location: string }
  | { kind: 'oversized-header' }
  | { kind: 'sized-body'; bytes: number; prefix?: string }
  | { kind: 'chunked-oversized' };

export function syntheticContactDirectory() {
  const user: SyntheticContactUser = {
    open_id: 'synthetic-open-agent', name: '合成坐席甲', job_title: '合成坐席', department_ids: ['dept-a'],
    status: { is_activated: true, is_frozen: false, is_resigned: false, is_exited: false, is_unjoin: false },
    is_tenant_manager: true, email: 'synthetic-not-a-credential@example.invalid',
  };
  const pages: Record<string, SyntheticJobPage> = {
    first: { items: [{ job_title_id: 'job-unused', name: '合成停用岗位', status: false }], has_more: true, page_token: 'second' },
    second: {
      items: [
        { job_title_id: 'job-agent', name: '合成坐席', status: true },
        { job_title_id: 'job-lead', name: '合成组长', status: true },
      ],
      has_more: false,
    },
  };
  return { user, pages };
}

export async function startSyntheticContactDouble() {
  const { user, pages } = syntheticContactDirectory();
  const requests: SyntheticContactRequest[] = [];
  const hung: ServerResponse[] = [];
  let mode: SyntheticContactMode = { kind: 'native' };
  let onRequest: (request: SyntheticContactRequest) => void = () => undefined;
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    const recorded = { method: req.method ?? '', url: req.url ?? '', authorization: header(req, 'authorization') };
    requests.push(recorded);
    onRequest(recorded);
    respond(req, res);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  function respond(req: IncomingMessage, res: ServerResponse) {
    const current = mode;
    if (current.kind === 'destroy') { res.destroy(); return; }
    if (current.kind === 'hang') { hung.push(res); return; }
    if (current.kind === 'redirect') {
      res.writeHead(302, { location: current.location }); res.end(); return;
    }
    if (current.kind === 'status') {
      res.writeHead(current.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(current.body); return;
    }
    if (current.kind === 'oversized-header') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '2000000' });
      res.flushHeaders();
      return;
    }
    if (current.kind === 'sized-body') {
      const body = Buffer.alloc(current.bytes, 0x78);
      Buffer.from(current.prefix ?? '').copy(body);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(body);
      return;
    }
    if (current.kind === 'chunked-oversized') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write(Buffer.from('secret-message'));
      res.end(Buffer.alloc(1_048_576, 0x78));
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = nativeBody(url);
    res.writeHead(body.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body.payload);
  }

  function nativeBody(url: URL): { status: number; payload: string } {
    if (url.pathname.startsWith('/open-apis/contact/v3/users/')) {
      return { status: 200, payload: JSON.stringify({ code: 0, msg: 'success', data: { user } }) };
    }
    if (url.pathname === '/open-apis/contact/v3/job_titles') {
      const token = url.searchParams.get('page_token') ?? 'first';
      const page = pages[token];
      if (!page) return { status: 404, payload: JSON.stringify({ code: 999, msg: 'secret-message' }) };
      return { status: 200, payload: JSON.stringify({ code: 0, msg: 'success', data: page }) };
    }
    return { status: 404, payload: JSON.stringify({ code: 999, msg: 'secret-message' }) };
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`, user, pages, requests,
    set mode(value: SyntheticContactMode) { mode = value; },
    get mode() { return mode; },
    set onRequest(value: (request: SyntheticContactRequest) => void) { onRequest = value; },
    release(body = '{"code":0,"msg":"late","data":{}}') {
      for (const response of hung.splice(0)) {
        try { response.end(body); } catch { response.destroy(); }
      }
    },
    async close() {
      for (const response of hung.splice(0)) response.destroy();
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value ?? '';
}
