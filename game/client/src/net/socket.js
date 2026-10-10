import { getToken } from './api.js';

// WebSocket connection to the game server with auto-reconnect and
// request/response RPC on top of the event stream.
export class Socket {
  constructor() {
    this.handlers = new Map();
    this.pending = new Map();
    this.rid = 0;
    this.ws = null;
    this.closedByUs = false;
    this.retry = 0;
    this.rtt = 80;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, msg) {
    this.handlers.get(type)?.forEach((fn) => fn(msg));
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken() || '')}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.emit('_open');
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 4000);
    };
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'res') {
        const p = this.pending.get(m.rid);
        if (p) {
          this.pending.delete(m.rid);
          m.ok ? p.resolve(m.data) : p.reject(new Error(m.err));
        }
        return;
      }
      if (m.t === 'pong') this.rtt = this.rtt * 0.7 + (performance.now() - m.c) * 0.3;
      this.emit(m.t, m);
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      for (const p of this.pending.values()) p.reject(new Error('Disconnected'));
      this.pending.clear();
      this.emit('_close', ev);
      if (this.closedByUs || ev.code === 4002 || ev.code === 4001) return;
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // Fire an action that expects an answer (errors become rejections).
  req(t, payload = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== 1) return reject(new Error('Not connected'));
      const rid = ++this.rid;
      this.pending.set(rid, { resolve, reject });
      this.send({ ...payload, t, rid });
      setTimeout(() => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          reject(new Error('The server took too long.'));
        }
      }, 10000);
    });
  }
  rpc(m, a = {}) {
    return this.req('rpc', { m, a });
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }
}
