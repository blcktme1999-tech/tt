'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(__dirname, '../public/video-session.js'), 'utf8');

// A small deterministic DOM, sufficient for the actual app templates and event
// handlers. No new dependencies or production-only testing globals are needed.
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[key]));
class Element {
  constructor(tag, doc) {
    this.tagName = tag.toLowerCase(); this.ownerDocument = doc;
    this.childNodes = []; this.parentNode = null; this.dataset = {}; this.attrs = {};
    this.className = ''; this.id = ''; this.value = ''; this.hidden = false;
    this.disabled = false; this.files = []; this.listeners = {}; this.style = {};
    this.scrollTop = 0; this.clientHeight = 120; this._text = ''; this._html = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? 'add' : 'remove'](name); return enabled; }
    };
  }
  get children() { return this.childNodes.filter((node) => node.tagName !== '#text'); }
  get isConnected() { return this === this.ownerDocument?.body || Boolean(this.parentNode?.isConnected); }
  get scrollHeight() { return this.children.length * 40; }
  get textContent() { return this._text + this.childNodes.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this.replaceChildren(); this._html = html;
    const stack = [this];
    for (const match of html.matchAll(/<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
      const token = match[0];
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([\w-]+)/)[1].toLowerCase();
        const node = this.ownerDocument.createElement(tag);
        for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) {
          node.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        }
        stack.at(-1).appendChild(node);
        if (!['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(node);
      } else if (token.trim()) {
        const text = this.ownerDocument.createElement('#text'); text._text = decode(token); stack.at(-1).appendChild(text);
      }
    }
    for (const select of this.querySelectorAll('select')) select.value = select.querySelector('option')?.value || '';
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    else if (name === 'class') this.className = value;
    else if (name === 'hidden' || name === 'disabled') this[name] = true;
    else if (['id', 'value', 'name', 'type'].includes(name)) this[name] = value;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    node.remove(); node.parentNode = this;
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(index, 0, node); return node;
  }
  remove() { if (this.parentNode) { const siblings = this.parentNode.childNodes; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); this._text = ''; for (const node of nodes) this.appendChild(node); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  matches(simple) {
    const tag = simple.match(/^[\w-]+/);
    if (tag && this.tagName !== tag[0]) return false;
    const id = simple.match(/#([\w-]+)/); if (id && this.id !== id[1]) return false;
    for (const match of simple.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
    for (const match of simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const value = match[1].startsWith('data-') ? this.dataset[match[1].slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] : this.getAttribute(match[1]);
      if (value === undefined || value === null || (match[2] !== undefined && value !== match[2])) return false;
    }
    return this.tagName !== '#text';
  }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/);
    const matches = (node) => {
      if (!node.matches(parts.at(-1))) return false;
      let parent = node.parentNode;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (parent && !parent.matches(parts[index])) parent = parent.parentNode;
        if (!parent) return false;
        parent = parent.parentNode;
      }
      return true;
    };
    const all = (node) => node.childNodes.flatMap((child) => [child, ...all(child)]);
    return all(this).filter(matches);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
  async fire(event) { for (const callback of this.listeners[event] || []) await callback({ currentTarget: this, target: this, preventDefault() {} }); }
  get elements() { return { namedItem: (name) => this.querySelector(`[name="${name}"]`) }; }
  reset() { for (const node of this.querySelectorAll('input')) { node.value = ''; node.files = []; } for (const node of this.querySelectorAll('textarea')) node.value = ''; }
  cloneNode() { const copy = this.ownerDocument.createElement(this.tagName); copy.innerHTML = this._html; return copy; }
  getBoundingClientRect() {
    const top = this.parentNode?.classList.contains('chat-log') ? this.parentNode.children.indexOf(this) * 40 - this.parentNode.scrollTop : 0;
    return { top, bottom: top + (this.classList.contains('chat-log') ? this.clientHeight : 40) };
  }
}

function makeDocument() {
  const doc = { createElement: (tag) => new Element(tag, doc) };
  doc.body = doc.createElement('body'); doc.body.dataset.entry = 'citizen';
  doc.querySelector = (selector) => doc.body.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.body.querySelectorAll(selector);
  doc.body.innerHTML = `<section id="citizenPanel" class="panel active"><form id="citizenForm"><input name="citizenName"><input name="nationalId"><button type="submit">我要視訊報案</button></form><div id="citizenStatus"></div><div id="citizenWorkspace" class="hidden"></div></section>
    <section id="staffPanel" class="panel"><div id="staffLogin"><form id="staffLoginForm"><input name="username"><input name="password"><button type="submit">登入</button></form></div><div id="staffWorkspace"></div></section>
    <section id="adminPanel" class="panel"><div id="adminWorkspace"></div></section><template id="caseWorkspaceTemplate"></template>`;
  const content = doc.createElement('fragment');
  content.innerHTML = `<div class="case-shell"><aside><button data-action="refreshCases">重新整理</button><input data-action="searchCases"><select data-action="filterCases"><option value="all">全部</option></select><span data-slot="caseCount"></span><div data-slot="caseList"></div></aside><section class="case-detail"><div data-slot="caseSummary"></div><div data-slot="media"></div><div data-slot="conversation"></div></section></div>`;
  doc.querySelector('#caseWorkspaceTemplate').content = content;
  return doc;
}

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const caseItem = (id, status = 'open', interviewStatus = 'idle') => ({ id, status, interviewStatus, citizenName: `民眾${id}`, agoraChannel: `ID${id}`, createdAt: '2026-01-01T00:00:00Z' });
const message = (id, minute = 1) => ({ id, senderType: 'citizen', senderName: '民眾', body: `訊息${id}`, createdAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z` });
const file = (id, minute = 2) => ({ id, originalName: `附件${id}`, size: 1024, uploadedBy: '承辦', url: '/uploads/safe.pdf', createdAt: message(id, minute).createdAt });

// Exercise the real controller callbacks/queue, mocking only the external SDK.
function mediaSDK() {
  const fixture = { clients: [], tracks: [], subscribeError: null, subscribeGate: null, cameraError: null };
  fixture.track = (kind) => ({
    kind, closes: 0, stops: 0, plays: 0,
    play() { this.plays++; }, stop() { this.stops++; }, close() { this.closes++; }
  });
  fixture.user = { uid: 'citizen-remote', hasVideo: true, videoTrack: fixture.track('video') };
  fixture.sdk = {
    createClient() {
      const handlers = new Map();
      const client = {
        remoteUsers: [fixture.user], joins: 0, leaves: 0, subscribes: 0,
        publishes: [], unpublishes: [],
        on(event, callback) { handlers.set(event, callback); },
        off(event) { handlers.delete(event); },
        async emit(event, ...args) { await handlers.get(event)?.(...args); },
        async join() { this.joins++; }, async leave() { this.leaves++; },
        async publish(track) { this.publishes.push(track); },
        async unpublish(track) { this.unpublishes.push(track); },
        async subscribe() {
          this.subscribes++;
          if (fixture.subscribeError) throw fixture.subscribeError;
          if (fixture.subscribeGate) await fixture.subscribeGate.promise;
        }
      };
      fixture.clients.push(client); return client;
    },
    async createCameraVideoTrack() {
      if (fixture.cameraError) throw fixture.cameraError;
      const track = fixture.track('video'); fixture.tracks.push(track); return track;
    },
    async createMicrophoneAudioTrack() {
      const track = fixture.track('audio'); fixture.tracks.push(track); return track;
    }
  };
  return fixture;
}

async function harness(options = {}) {
  const doc = makeDocument(), requests = [], controllers = [], calls = [], timers = new Map();
  const h = { doc, requests, controllers, calls, timers, me: options.me || {}, cases: options.cases || [], confirm: true, readerCalls: 0 };
  if (options.entry) doc.body.dataset.entry = options.entry;
  const window = {
    location: { origin: 'https://example.test', pathname: options.pathname || '/service', hash: options.hash || '' },
    history: { replaceState(_a, _b, url) {
      const next = new URL(url, `${window.location.origin}${window.location.pathname}`);
      window.location.pathname = next.pathname; window.location.hash = next.hash;
    } },
    confirm: (text) => { calls.push(['confirm', text]); return h.confirm; },
    alert() { throw new Error('Unexpected alert'); }
  };
  class Session {
    constructor(config) { Object.assign(this, config); this.tracks = new Map(); this.connected = false; this.busy = false; this.status = 'idle'; this.caseId = null; this.audioBlocked = false; controllers.push(this); }
    get hasLocalMedia() { return this.tracks.size > 0; }
    async connect(id, root) {
      if (this.connected && this.caseId === id && this.root === root) return;
      assert.ok(root.isConnected); assert.equal(root.dataset.caseId, id);
      this.busy = true; this.caseId = id; this.root = root; this.status = 'connecting'; this.onChange(this);
      calls.push(['connect', id]);
      try {
        await this.getToken(id);
        if (h.connectGate) await h.connectGate.promise;
        assert.ok(root.isConnected, 'root remains attached throughout join');
        this.connected = true; this.status = 'connected'; this.lastError = null;
      } catch (error) { this.connected = false; this.status = 'error'; this.lastError = error; this.onError(error); throw error; }
      finally { this.busy = false; this.onChange(this); }
    }
    async setDevice(kind, enabled) { calls.push(['device', kind, enabled]); if (enabled) this.tracks.set(kind, {}); else this.tracks.delete(kind); this.onChange(this); }
    async publishBoth() {
      calls.push(['publishBoth', this.caseId]);
      if (h.publishError) { this.lastError = h.publishError; this.onError(h.publishError); throw h.publishError; }
      this.lastError = null;
      await this.setDevice('video', true); await this.setDevice('audio', true);
    }
    async disconnect() { calls.push(['disconnect', this.caseId, this.tracks.size]); this.tracks.clear(); this.connected = false; this.caseId = this.root = null; this.status = 'idle'; this.onChange(this); }
    async resumeAudio() { calls.push(['resumeAudio']); this.audioBlocked = false; return true; }
  }
  window.ReportVideoSession = Session;
  const defaultRoute = (url, init) => {
    if (url === '/api/me') return h.me;
    if (url === '/api/cases') return { cases: h.cases };
    if (url === '/api/users') return { users: [] };
    if (url.endsWith('/messages')) return { messages: [] };
    if (url.endsWith('/files')) return { files: [] };
    if (url.endsWith('/agora-token')) return { appId: 'app', uid: 'uid', channelName: 'room', token: 'mock' };
    if (url.endsWith('/statement')) return { case: { ...caseItem(url.split('/')[3]), interviewStatus: JSON.parse(init.body).active ? 'active' : 'idle' } };
    throw new Error(`Unhandled mock route: ${url}`);
  };
  const context = vm.createContext({
    window, document: doc, URL, URLSearchParams, console,
    setInterval(fn, ms) { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; }, clearInterval(id) { timers.delete(id); },
    FileReader: class { readAsDataURL() { h.readerCalls++; this.result = 'data:text/plain;base64,eA=='; this.onload(); } },
    fetch: async (url, init = {}) => {
      requests.push({ url, ...init });
      const data = await (h.route ? h.route(url, init, defaultRoute) : defaultRoute(url, init));
      if (data?.rawResponse) return data.rawResponse;
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
    }
  });
  if (options.sdk) {
    window.AgoraRTC = options.sdk;
    vm.runInContext(controllerSource, context, { filename: 'video-session.js' });
    const Controller = window.ReportVideoSession;
    window.ReportVideoSession = class extends Controller {
      constructor(config) { super(config); controllers.push(this); }
    };
  }
  h.window = window;
  vm.runInContext(source, context, { filename: 'app.js' });
  h.app = vm.runInContext('({ state, bootPromise, api, selectCase, loadCases, refreshMessages, renderCaseShell, renderCitizenWorkspace, filterCaseItems, safeFileUrl, displayMessage, uploadVideo, mergeConversation, startCasePolling, runMediaAction, enterCitizen, loginStaff, renderMediaState, showMediaError })', context);
  h.$ = (selector, root = doc) => root.querySelector(selector);
  h.flush = async () => { await tick(); await h.app.state.workflow; await tick(); };
  await h.app.bootPromise; await h.flush();
  h.staff = async (admin = false) => {
    h.app.state.me = { user: { role: admin ? 'admin' : 'agent' } };
    h.app.state.cases = h.cases;
    const root = h.$(admin ? '#adminWorkspace' : '#staffWorkspace');
    h.app.renderCaseShell(root, h.cases, admin); return root;
  };
  return h;
}

test('production API fails closed on network, HTML, malformed JSON and HTTP failures', async () => {
  const h = await harness();
  h.route = () => { throw new Error('offline'); };
  await assert.rejects(h.app.api('/api/cases'), /無法連線/);
  h.route = () => ({ rawResponse: { ok: true, headers: { get: () => 'text/html' } } });
  await assert.rejects(h.app.api('/api/cases'), /JSON/);
  h.route = () => ({ rawResponse: { ok: true, headers: { get: () => 'application/json' }, json: async () => { throw new Error('parse'); } } });
  await assert.rejects(h.app.api('/api/cases'), /格式錯誤/);
  h.route = () => ({ rawResponse: { ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: '拒絕存取' }) } });
  await assert.rejects(h.app.api('/api/cases'), /拒絕存取/);
  assert.equal(h.controllers.length, 0);
});

test('staff selects idle open case: automatically receives, independent toggles, no receiver stop', async () => {
  const a = caseItem('a'), h = await harness({ cases: [a] }), root = await h.staff();
  await h.app.selectCase(root, a); await h.flush();
  const media = h.app.state.callRoot;
  assert.equal(h.controllers.length, 1); assert.equal(h.controllers[0].connected, true);
  assert.equal(h.controllers[0].hasLocalMedia, false);
  assert.equal(h.$('[data-action="leaveCall"]', media), null);
  assert.equal(h.$('[data-action="joinCall"]', media), null);
  await h.$('[data-action="toggleAudio"]', media).fire('click'); await h.flush();
  assert.deepEqual([...h.controllers[0].tracks.keys()], ['audio']);
  await h.$('[data-action="toggleVideo"]', media).fire('click'); await h.flush();
  await h.$('[data-action="toggleAudio"]', media).fire('click'); await h.flush();
  await h.$('[data-action="toggleVideo"]', media).fire('click'); await h.flush();
  assert.equal(h.controllers[0].hasLocalMedia, false); assert.equal(h.controllers[0].connected, true);
  assert.equal(h.calls.filter(([kind]) => kind === 'connect').length, 1);
  assert.equal(h.$('[data-slot="recordingNotice"]', media).textContent, '視訊筆錄進行中｜錄影尚未啟用');
});

test('guarded selection declines switch, then closes own media and enters next case receive-only', async () => {
  const a = caseItem('a'), b = caseItem('b'), h = await harness({ cases: [a, b] }), root = await h.staff();
  await h.app.selectCase(root, a);
  await h.controllers[0].setDevice('video', true);
  const player = h.$('[data-slot="localPlayer"]', h.app.state.callRoot);
  h.confirm = false;
  assert.equal(await h.app.selectCase(root, b), false);
  assert.equal(h.app.state.currentCase.id, 'a'); assert.ok(player.isConnected);
  h.confirm = true;
  await h.app.selectCase(root, b);
  assert.equal(h.controllers.length, 1); assert.equal(h.controllers[0].caseId, 'b');
  assert.equal(h.controllers[0].hasLocalMedia, false); assert.equal(player.isConnected, false);
  const disconnect = h.calls.findIndex(([kind, id, tracks]) => kind === 'disconnect' && id === 'a' && tracks === 1);
  assert.ok(disconnect >= 0 && disconnect < h.calls.findIndex(([kind, id]) => kind === 'connect' && id === 'b'));
});

test('rapid selections wait for join and never connect to detached roots or publish automatically', async () => {
  const a = caseItem('a'), b = caseItem('b'), h = await harness({ cases: [a, b] }), root = await h.staff();
  const gate = h.connectGate = deferred();
  const first = h.app.selectCase(root, a); await tick();
  const oldPlayer = h.$('[data-slot="localPlayer"]', h.app.state.callRoot);
  const next = h.app.selectCase(root, b); await tick();
  assert.ok(oldPlayer.isConnected); assert.equal(h.controllers[0].connected, false);
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'connect').map((call) => call[1]), ['a']);
  h.connectGate = null; gate.resolve(); await Promise.all([first, next]);
  assert.equal(h.app.state.currentCase.id, 'b'); assert.equal(h.controllers[0].hasLocalMedia, false);
});

test('pending detail loads messages and approval, but no files/token; approval starts selected receiver', async () => {
  const pending = caseItem('p', 'pending'), h = await harness({ cases: [pending] }), root = await h.staff(true);
  h.route = (url, init, fallback) => url.endsWith('/approve') ? { case: caseItem('p') } : fallback(url, init);
  await h.app.selectCase(root, pending, true); await h.flush();
  assert.ok(h.requests.some((request) => request.url.endsWith('/messages')));
  assert.equal(h.requests.some((request) => /\/(files|agora-token)$/.test(request.url)), false);
  assert.equal(h.$('[data-action="approve"]', root).hidden, false);
  await h.$('[data-action="approve"]', root).fire('click'); await h.flush();
  assert.equal(h.app.state.currentCase.status, 'open'); assert.equal(h.controllers[0].connected, true);
  assert.ok(h.requests.some((request) => request.url.endsWith('/files')));
});

test('polling and manual refresh keep selected media, composer, filters and never jump to active case', async () => {
  const a = caseItem('a'), h = await harness({ cases: [a] }), root = await h.staff();
  await h.app.selectCase(root, a); await h.flush();
  const player = h.$('[data-slot="localPlayer"]', root), input = h.$('.message-form textarea', root);
  input.value = '保留草稿'; h.$('[data-action="searchCases"]', root).value = 'IDa';
  h.$('[data-action="filterCases"]', root).value = 'open';
  h.cases = [caseItem('a'), caseItem('other', 'open', 'active')];
  await h.app.loadCases(); await h.app.loadCases();
  assert.equal(h.app.state.currentCase.id, 'a'); assert.equal(h.$('[data-slot="localPlayer"]', root), player);
  assert.equal(h.$('.message-form textarea', root), input); assert.equal(input.value, '保留草稿');
  assert.equal(h.$('[data-action="searchCases"]', root).value, 'IDa');
  assert.equal(h.$('[data-action="filterCases"]', root).value, 'open');
  assert.equal(h.$('[data-slot="caseCount"]', root).textContent, '1');
  assert.equal(h.calls.filter(([kind]) => kind === 'connect').length, 1);
  h.app.startCasePolling();
  assert.ok([...h.timers.values()].some((timer) => timer.ms === 3000));
});

test('search covers name/id/national id; admin sees closed/pending; agent only open; list text escaped', async () => {
  const malicious = { ...caseItem('a'), citizenName: '<img src=x onerror=alert(1)>' };
  const h = await harness({ cases: [malicious, caseItem('b', 'pending'), caseItem('c', 'closed'), caseItem('d', 'open', 'active')] });
  const root = await h.staff(true);
  assert.equal(h.app.filterCaseItems(h.cases, true, 'IDb').length, 1);
  assert.equal(h.app.filterCaseItems(h.cases, false).length, 2);
  assert.equal(h.app.filterCaseItems(h.cases, true, '', 'active')[0].id, 'd');
  assert.equal(h.app.filterCaseItems(h.cases, true, '', 'closed')[0].id, 'c');
  assert.equal(h.$('[data-slot="caseList"] img', root), null);
  assert.match(h.$('.case-card', root).innerHTML, /&lt;img/);
});

test('citizen reload renders two default tiles but does not connect or capture', async () => {
  const h = await harness({ me: { case: caseItem('c') } });
  assert.equal(h.controllers.length, 0);
  assert.equal(h.$('[data-slot="videoGrid"]', h.app.state.callRoot).children.length, 2);
  assert.equal(h.$('[data-slot="recordingNotice"]', h.app.state.callRoot).textContent, '錄影尚未啟用');
  await h.$('[data-action="joinCall"]', h.app.state.callRoot).fire('click'); await h.flush();
  assert.equal(h.controllers[0].tracks.size, 2);
  await h.$('[data-action="leaveCall"]', h.app.state.callRoot).fire('click'); await h.flush();
  assert.equal(h.controllers[0].connected, false);
  assert.equal(h.app.state.currentCase.interviewStatus, 'idle');
  assert.equal(JSON.parse(h.requests.filter((request) => request.url.endsWith('/statement')).at(-1).body).active, false);
});

test('citizen submit uses POST, publishes both; permissions error is inline and retry keeps workspace', async () => {
  const h = await harness();
  h.route = (url, init, fallback) => {
    if (url === '/api/citizen/start') { h.me = { case: caseItem('c') }; return { status: 'open', case: caseItem('c') }; }
    return fallback(url, init);
  };
  h.publishError = new Error('請允許攝影機與麥克風');
  const form = h.$('#citizenForm'); form.elements.namedItem('citizenName').value = '測試'; form.elements.namedItem('nationalId').value = 'TEST123';
  await form.fire('submit'); await h.flush();
  const request = h.requests.find((item) => item.url === '/api/citizen/start');
  assert.equal(request.method, 'POST'); assert.equal(JSON.parse(request.body).nationalId, 'TEST123');
  assert.equal(h.$('#citizenWorkspace').classList.contains('hidden'), false);
  assert.match(h.$('[data-slot="mediaError"]', h.app.state.callRoot).textContent, /請允許/);
  h.publishError = null;
  await h.$('[data-action="retryMedia"]', h.app.state.callRoot).fire('click'); await h.flush();
  assert.equal(h.controllers[0].tracks.size, 2); assert.equal(h.app.state.currentCase.interviewStatus, 'active');
});

test('citizen entry with staff cookie shows identity notice without PII or media activity', async () => {
  const h = await harness({ me: { user: { role: 'admin', displayName: 'PRIVATE NAME', username: 'PRIVATE LOGIN' }, case: caseItem('c') } });
  assert.match(h.$('#citizenStatus').textContent, /另一個瀏覽器/);
  assert.doesNotMatch(h.$('#citizenStatus').textContent, /PRIVATE/);
  await h.$('#citizenForm').fire('submit'); await h.flush();
  assert.equal(h.requests.some((request) => request.url === '/api/citizen/start'), false);
  assert.equal(h.controllers.length, 0);
});

test('staff login POST keeps credentials out of URL and verifies me', async () => {
  const h = await harness();
  h.route = (url, init, fallback) => {
    if (url === '/api/staff/login') { h.me = { user: { role: 'agent' } }; return h.me; }
    return fallback(url, init);
  };
  const form = h.$('#staffLoginForm'); form.elements.namedItem('username').value = 'staff'; form.elements.namedItem('password').value = 'TEST-PASSWORD';
  await form.fire('submit'); await h.flush();
  const request = h.requests.find((item) => item.url === '/api/staff/login');
  assert.equal(request.method, 'POST'); assert.equal(JSON.parse(request.body).password, 'TEST-PASSWORD');
  assert.equal(h.requests.some((item) => item.url.includes('TEST-PASSWORD')), false);
  assert.equal(form.elements.namedItem('password').value, '');
  assert.equal(h.app.state.me.user.role, 'agent');
});

test('message/file stream is chronological, deduplicated, and preserves older-reading scroll anchor', async () => {
  const h = await harness({ me: { case: caseItem('c') } }), ctx = h.app.state.conversation;
  const messages = Array.from({ length: 10 }, (_, i) => message(String(i), i + 2));
  h.app.mergeConversation(ctx, messages, [file('f', 5)]);
  const log = h.$('.chat-log', ctx.root); log.scrollTop = 120;
  const anchor = log.children[3], before = anchor.getBoundingClientRect().top;
  h.app.mergeConversation(ctx, [messages[0], message('older', 1)], [file('f', 5)]);
  assert.equal(log.children.length, 12); assert.equal(anchor.getBoundingClientRect().top, before);
  assert.equal(log.children[0].textContent.includes('訊息older'), true);
  assert.equal(log.children.filter((node) => node.classList.contains('file-message')).length, 1);
  assert.match(log.children.find((node) => node.classList.contains('file-message')).textContent, /1.0 KiB.*承辦/);
});

test('conversation polling coalesces concurrent refresh and discards response after case switch', async () => {
  const a = caseItem('a'), b = caseItem('b'), h = await harness({ cases: [a, b] }), root = await h.staff();
  await h.app.selectCase(root, a); await h.flush();
  const gate = deferred();
  h.route = (url, init, fallback) => url === '/api/cases/a/messages' ? gate.promise : fallback(url, init);
  const first = h.app.refreshMessages('a'), second = h.app.refreshMessages('a');
  assert.equal(first, second);
  await h.app.selectCase(root, b); await h.flush();
  gate.resolve({ messages: [message('STALE')] }); await first;
  assert.equal(h.app.state.currentCase.id, 'b'); assert.equal(h.$('.chat-log', root).textContent.includes('STALE'), false);
});

test('pending message submit is disabled; failed request retains text, retry inserts once', async () => {
  const h = await harness({ me: { case: caseItem('c') } });
  const form = h.$('.message-form', h.app.state.detailRoot), input = form.elements.namedItem('body'), button = h.$('button[type="submit"]', form);
  const gate = deferred(); input.value = '保留這段訊息';
  h.route = (url, init, fallback) => init.method === 'POST' && url.endsWith('/messages') ? gate.promise : fallback(url, init);
  const submit = form.fire('submit'); await tick(); assert.equal(button.disabled, true);
  await form.fire('submit');
  gate.reject(new Error('offline')); await submit;
  assert.equal(input.value, '保留這段訊息'); assert.equal(button.disabled, false);
  assert.match(form.textContent, /無法連線/);
  h.route = (url, init, fallback) => init.method === 'POST' && url.endsWith('/messages') ? { message: message('sent') } : fallback(url, init);
  await form.fire('submit'); assert.equal(input.value, '');
  assert.equal(h.$('.chat-log', h.app.state.detailRoot).children.length, 1);
});

test('uploads reject over 3 MiB before reading; successful cards merge with subsequent poll without duplicates', async () => {
  const h = await harness({ me: { case: caseItem('c') } });
  await assert.rejects(h.app.uploadVideo('c', { size: 3 * 1024 * 1024 + 1 }, 'large'), /3 MiB/);
  assert.equal(h.readerCalls, 0);
  h.route = (url, init, fallback) => url.endsWith('/files') ? init.method === 'POST' ? { file: file('uploaded') } : { files: [file('uploaded')] } : fallback(url, init);
  await h.app.uploadVideo('c', { size: 3 * 1024 * 1024, type: 'text/plain' }, 'safe.txt');
  await h.app.refreshMessages('c');
  assert.equal(h.$('.chat-log', h.app.state.detailRoot).children.length, 1);
  assert.equal(h.readerCalls, 1);
  assert.equal(JSON.parse(h.requests.find((request) => request.url.endsWith('/files') && request.method === 'POST').body).kind, 'upload');
});

test('attachment URLs only allow HTTP/S; all card and historical text is escaped', async () => {
  const h = await harness({ me: { case: caseItem('c') } });
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'blob:https://example.test/id', '#', 'https://user:password@example.test', '']) assert.equal(h.app.safeFileUrl(url), null);
  assert.equal(h.app.safeFileUrl('/uploads/a'), 'https://example.test/uploads/a');
  h.app.mergeConversation(h.app.state.conversation, [{ ...message('x'), senderName: '<script>x</script>', body: '管理員已開通線上客服系統。' }], [{ ...file('x'), originalName: '<img>', uploadedBy: '<script>', url: 'javascript:alert(1)' }]);
  const log = h.$('.chat-log', h.app.state.detailRoot);
  assert.equal(log.querySelector('script'), null); assert.equal(log.querySelector('img'), null); assert.equal(log.querySelector('a'), null);
  assert.match(log.textContent, /已開通線上報案系統。/);
});

test('play audio executes directly from clicked current root, not behind workflow queue', async () => {
  const a = caseItem('a'), h = await harness({ cases: [a] }), root = await h.staff();
  await h.app.selectCase(root, a);
  const gate = deferred(); h.app.state.workflow = gate.promise;
  await h.$('[data-action="resumeAudio"]', root).fire('click');
  assert.equal(h.calls.at(-1)[0], 'resumeAudio'); gate.resolve();
});

test('failed automatic receive shows inline retry and never marks a failed join connected', async () => {
  const a = caseItem('a'), h = await harness({ cases: [a] }), root = await h.staff();
  h.route = (url, init, fallback) => {
    if (url.endsWith('/agora-token')) throw new Error('offline');
    return fallback(url, init);
  };
  await h.app.selectCase(root, a);
  assert.equal(h.controllers[0].connected, false);
  assert.equal(h.$('[data-action="retryMedia"]', root).hidden, false);
  assert.equal(h.$('[data-slot="recordingNotice"]', root).textContent, '錄影尚未啟用');
  h.route = null;
  await h.$('[data-action="retryMedia"]', root).fire('click'); await h.flush();
  assert.equal(h.controllers[0].connected, true); assert.equal(h.controllers[0].hasLocalMedia, false);
  assert.equal(h.controllers.length, 1);
});

test('closed status disconnects selected media without destroying chat or selecting another case', async () => {
  const a = caseItem('a'), h = await harness({ cases: [a] }), root = await h.staff();
  await h.app.selectCase(root, a);
  await h.controllers[0].setDevice('audio', true);
  const chat = h.$('.chat-log', root), player = h.$('[data-slot="localPlayer"]', root);
  h.cases = [caseItem('a', 'closed'), caseItem('other', 'open', 'active')];
  await h.app.loadCases();
  assert.equal(h.controllers[0].connected, false); assert.equal(h.controllers[0].tracks.size, 0);
  assert.equal(h.$('.chat-log', root), chat); assert.equal(h.$('[data-slot="localPlayer"]', root), player);
  assert.equal(h.app.state.currentCase.id, 'a'); assert.equal(h.$('[data-action="toggleVideo"]', root).disabled, true);
});

test('overlapping case refresh coalesces; first load does not automatically select any active case', async () => {
  const h = await harness({ cases: [caseItem('active', 'open', 'active')] });
  await h.staff();
  const gate = deferred();
  h.route = (url, init, fallback) => url === '/api/cases' ? gate.promise : fallback(url, init);
  const first = h.app.loadCases(), second = h.app.loadCases();
  assert.equal(first, second);
  gate.resolve({ cases: h.cases }); await first;
  assert.equal(h.app.state.currentCase, null); assert.equal(h.controllers.length, 0);
});

test('admin preapproval and account creation survive refresh, show failures inline and preserve inputs', async () => {
  const h = await harness({ entry: 'mixed', me: { user: { role: 'admin' } } });
  const create = h.$('#createCaseForm'), user = h.$('#createUserForm');
  assert.ok(create); assert.ok(user);
  create.elements.namedItem('citizenName').value = '預先開通';
  create.elements.namedItem('nationalId').value = 'TEST123';
  h.route = (url, init, fallback) => {
    if (url === '/api/cases' && init.method === 'POST') { h.cases = [caseItem('new')]; return { case: h.cases[0] }; }
    if (url === '/api/users' && init.method === 'POST') throw new Error('offline');
    return fallback(url, init);
  };
  await create.fire('submit'); await h.flush();
  assert.equal(h.app.state.cases[0].id, 'new'); assert.equal(h.app.state.currentCase, null);
  assert.equal(create.elements.namedItem('citizenName').value, '');
  user.elements.namedItem('username').value = 'new-agent'; user.elements.namedItem('password').value = 'TEST-PASSWORD';
  await user.fire('submit'); await h.flush();
  assert.equal(user.elements.namedItem('username').value, 'new-agent');
  assert.match(user.textContent, /無法連線/); assert.equal(h.$('button[type="submit"]', user).disabled, false);
  await h.app.loadCases();
  assert.equal(h.$('#createUserForm'), user); assert.equal(h.doc.querySelectorAll('#createUserForm').length, 1);
  h.route = (url, init, fallback) => url === '/api/users' && init.method === 'POST' ? { ok: true } : fallback(url, init);
  await user.fire('submit'); await h.flush();
  assert.equal(user.elements.namedItem('password').value, '');
});

for (const role of ['staff', 'citizen']) {
  for (const reconnecting of [false, true]) {
    for (const kind of ['video', 'audio']) {
      test(`${role} disables only ${kind} while ${reconnecting ? 'reconnecting' : 'connected'}, without connect/cleanup/rejoin`, async () => {
        const sdk = mediaSDK(), a = caseItem('a');
        const h = await harness({ sdk: sdk.sdk, cases: [a], me: role === 'citizen' ? { case: a } : {} });
        if (role === 'staff') await h.app.selectCase(await h.staff(), a);
        else { await h.$('[data-action="joinCall"]', h.app.state.callRoot).fire('click'); await h.flush(); }
        const session = h.controllers[0], root = h.app.state.callRoot;
        await session.publishBoth(); await h.flush();
        const client = sdk.clients[0], removed = session.tracks.get(kind);
        const otherKind = kind === 'video' ? 'audio' : 'video', retained = session.tracks.get(otherKind);
        if (reconnecting) await client.emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
        let connectCalls = 0;
        const connect = session.connect.bind(session);
        session.connect = (...args) => { connectCalls++; return connect(...args); };
        const tokenCount = h.requests.filter((item) => item.url.endsWith('/agora-token')).length;
        const button = h.$(`[data-action="${kind === 'video' ? 'toggleVideo' : 'toggleAudio'}"]`, root);
        assert.equal(button.disabled, false); assert.equal(button.getAttribute('aria-pressed'), 'true');
        await button.fire('click'); await h.flush();
        assert.equal(connectCalls, 0); assert.equal(sdk.clients.length, 1); assert.equal(client.leaves, 0);
        assert.equal(h.requests.filter((item) => item.url.endsWith('/agora-token')).length, tokenCount);
        assert.equal(removed.closes, 1); assert.equal(retained.closes, 0);
        assert.equal(session.tracks.has(kind), false); assert.equal(session.tracks.get(otherKind), retained);
        assert.deepEqual(client.unpublishes, [removed]); assert.equal(client.publishes.length, 2);
        assert.equal(sdk.user.videoTrack.stops, 0); assert.equal(button.getAttribute('aria-pressed'), 'false');
        assert.equal(session.connected, !reconnecting);
        assert.equal(session.status, reconnecting ? 'reconnecting' : 'connected');
        if (role === 'citizen') assert.equal(JSON.parse(h.requests.filter((item) => item.url.endsWith('/statement')).at(-1).body).active, true);
        if (reconnecting) await client.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
        assert.equal(session.tracks.get(otherKind), retained); assert.equal(removed.closes, 1);
      });
    }
  }
}

for (const reconnecting of [false, true]) {
  for (const kind of ['video', 'audio']) {
    test(`enabling ${kind} still connects before capture while ${reconnecting ? 'reconnecting' : 'connected'}`, async () => {
      const sdk = mediaSDK(), a = caseItem('a'), h = await harness({ sdk: sdk.sdk, cases: [a] });
      await h.app.selectCase(await h.staff(), a);
      const session = h.controllers[0], operations = [];
      if (reconnecting) await sdk.clients[0].emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
      const connect = session.connect.bind(session), setDevice = session.setDevice.bind(session);
      session.connect = async (...args) => { operations.push('connect'); await connect(...args); operations.push('connected'); };
      session.setDevice = (...args) => { operations.push('device'); assert.equal(session.connected, true); return setDevice(...args); };
      await h.$(`[data-action="${kind === 'video' ? 'toggleVideo' : 'toggleAudio'}"]`, h.app.state.callRoot).fire('click'); await h.flush();
      assert.deepEqual(operations, ['connect', 'connected', 'device']);
      assert.deepEqual([...session.tracks.keys()], [kind]); assert.equal(sdk.tracks.length, 1);
      assert.equal(sdk.clients.length, reconnecting ? 2 : 1); assert.equal(sdk.clients[0].leaves, reconnecting ? 1 : 0);
    });
  }
}

for (const kinds of [[], ['video'], ['audio'], ['video', 'audio']]) {
  test(`local label reflects ${kinds.join('+') || 'no tracks'} before, during and after SDK recovery`, async () => {
    const sdk = mediaSDK(), a = caseItem('a'), h = await harness({ sdk: sdk.sdk, cases: [a] });
    await h.app.selectCase(await h.staff(), a);
    const session = h.controllers[0], root = h.app.state.callRoot;
    for (const kind of kinds) await session.setDevice(kind, true);
    const tracks = [...session.tracks.values()];
    const expected = `我方（鏡頭${kinds.includes('video') ? '已開啟' : '未開啟'}／麥克風${kinds.includes('audio') ? '已開啟' : '未開啟'}）`;
    const check = () => {
      assert.equal(h.$('[data-slot="localLabel"]', root).textContent, expected);
      for (const [kind, action] of [['video', 'toggleVideo'], ['audio', 'toggleAudio']]) {
        assert.equal(h.$(`[data-action="${action}"]`, root).getAttribute('aria-pressed'), String(kinds.includes(kind)));
      }
      assert.ok(tracks.every((track) => track.closes === 0));
    };
    check();
    await sdk.clients[0].emit('connection-state-change', 'RECONNECTING', 'CONNECTED'); check();
    assert.match(h.$('[data-slot="callStatus"]', root).textContent, /重新連線/);
    await sdk.clients[0].emit('connection-state-change', 'CONNECTED', 'RECONNECTING'); check();
    await session.disconnect();
    assert.equal(h.$('[data-slot="localLabel"]', root).textContent, '我方（鏡頭未開啟／麥克風未開啟）');
  });
}

test('queued toggles reject stale case/root, detached roots and non-open cases before touching devices', async () => {
  for (const invalidation of ['case', 'root', 'detached', 'closed', 'pending']) {
    const sdk = mediaSDK(), a = caseItem('a'), b = caseItem('b');
    const h = await harness({ sdk: sdk.sdk, cases: [a, b] }), workspace = await h.staff();
    await h.app.selectCase(workspace, a); await h.controllers[0].publishBoth();
    const root = h.app.state.callRoot, gate = deferred();
    h.app.state.workflow = gate.promise;
    const click = h.$('[data-action="toggleVideo"]', root).fire('click'); await tick();
    if (invalidation === 'case') h.app.state.currentCase = b;
    else if (invalidation === 'root') h.app.state.callRoot = h.doc.createElement('div');
    else if (invalidation === 'detached') root.remove();
    else h.app.state.currentCase = caseItem('a', invalidation);
    gate.resolve(); await click; await h.flush();
    assert.equal(sdk.clients.length, 1); assert.equal(sdk.clients[0].leaves, 0);
    assert.equal(sdk.clients[0].unpublishes.length, 0); assert.equal(h.controllers[0].tracks.size, 2);
    assert.match(h.app.state.mediaError, invalidation === 'closed' || invalidation === 'pending' ? /尚未開通或已結案/ : /案件已切換/);
  }
});

for (const recovery of ['retry button', 'remote event']) {
  for (const workflowFailure of [false, true]) {
    test(`${recovery} clears only recovered controller errors${workflowFailure ? ', preserving API workflow error' : ''}`, async () => {
      const sdk = mediaSDK(), a = caseItem('a'), h = await harness({ sdk: sdk.sdk, cases: [a] });
      await h.app.selectCase(await h.staff(), a); await h.flush();
      const session = h.controllers[0], root = h.app.state.callRoot, client = sdk.clients[0];
      if (workflowFailure) {
        h.route = () => ({ rawResponse: { ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: '筆錄 API 工作流程失敗' }) } });
        await h.app.runMediaAction('a', root, () => h.app.api('/api/cases/a/statement', { method: 'POST' })).catch(h.app.showMediaError);
        h.route = null;
      }
      const appError = h.app.state.mediaError;
      await client.emit('user-unpublished', sdk.user, 'video');
      sdk.subscribeError = new Error('遠端訂閱失敗');
      await client.emit('user-published', sdk.user, 'video'); await h.flush();
      assert.equal(session.lastError, sdk.subscribeError);
      assert.equal(h.app.state.mediaError, appError, 'controller callback must not overwrite/cache application errors');
      assert.equal(h.$('[data-slot="mediaError"]', root).hidden, false);
      assert.equal(h.$('[data-action="retryMedia"]', root).hidden, false);
      const failure = session.lastError;
      sdk.subscribeError = null; const gate = sdk.subscribeGate = deferred();
      let pending;
      if (recovery === 'retry button') await h.$('[data-action="retryMedia"]', root).fire('click');
      else pending = client.emit('user-published', sdk.user, 'video');
      await h.flush();
      assert.equal(session.lastError, failure, 'pending retry is not recovery');
      assert.equal(h.$('[data-slot="mediaError"]', root).hidden, false);
      assert.equal(h.app.state.mediaError, appError);
      gate.resolve(); await pending; await h.flush();
      assert.equal(session.lastError, null); assert.equal(session.status, 'connected');
      assert.equal(h.app.state.mediaError, appError);
      assert.equal(h.$('[data-slot="mediaError"]', root).hidden, !workflowFailure);
      assert.equal(h.$('[data-action="retryMedia"]', root).hidden, !workflowFailure);
      if (workflowFailure) assert.match(h.$('[data-slot="mediaError"]', root).textContent, /筆錄 API 工作流程失敗/);
      else assert.doesNotMatch(h.$('[data-slot="callStatus"]', root).textContent, /錯誤|失敗/);
      assert.equal(sdk.clients.length, 1); assert.equal(client.leaves, 0);
    });
  }
}

test('rejected controller operation is not cached and audio recovery preserves workflow errors', async () => {
  const sdk = mediaSDK(), a = caseItem('a'), h = await harness({ sdk: sdk.sdk, cases: [a] });
  await h.app.selectCase(await h.staff(), a);
  const session = h.controllers[0], root = h.app.state.callRoot;
  sdk.cameraError = new Error('攝影機權限被拒絕');
  await h.$('[data-action="toggleVideo"]', root).fire('click'); await h.flush();
  assert.equal(h.app.state.mediaError, ''); assert.equal(session.lastError, sdk.cameraError);
  assert.match(h.$('[data-slot="mediaError"]', root).textContent, /攝影機權限被拒絕/);
  sdk.cameraError = null;
  await h.$('[data-action="toggleVideo"]', root).fire('click'); await h.flush();
  assert.equal(h.$('[data-slot="mediaError"]', root).hidden, true);
  h.app.showMediaError(new Error('無關的工作流程錯誤'));
  sdk.sdk.onAutoplayFailed();
  assert.equal(session.audioBlocked, true); assert.equal(h.app.state.mediaError, '無關的工作流程錯誤');
  await h.$('[data-action="resumeAudio"]', root).fire('click'); await h.flush();
  assert.equal(session.audioBlocked, false); assert.equal(session.lastError, null);
  assert.equal(h.app.state.mediaError, '無關的工作流程錯誤');
  assert.match(h.$('[data-slot="mediaError"]', root).textContent, /無關的工作流程錯誤/);
});

test('real failed connect remains visible after controller cleanup and clears on retry', async () => {
  const sdk = mediaSDK(), a = caseItem('a'), h = await harness({ sdk: sdk.sdk, cases: [a] });
  const root = await h.staff();
  h.route = (url, init, fallback) => { if (url.endsWith('/agora-token')) throw new Error('offline'); return fallback(url, init); };
  await h.app.selectCase(root, a);
  assert.equal(h.controllers[0].caseId, null); assert.equal(h.app.state.mediaError, '');
  assert.match(h.$('[data-slot="mediaError"]', root).textContent, /無法連線/);
  h.route = null;
  await h.$('[data-action="retryMedia"]', root).fire('click'); await h.flush();
  assert.equal(h.controllers[0].connected, true); assert.equal(h.$('[data-slot="mediaError"]', root).hidden, true);
});

test('partial device failure plus statement failure retains only the workflow error after media recovery', async () => {
  const sdk = mediaSDK(), h = await harness({ sdk: sdk.sdk, me: { case: caseItem('a') } });
  sdk.cameraError = new Error('攝影機拒絕');
  h.route = (url, init, fallback) => url.endsWith('/statement') ? {} : fallback(url, init);
  const root = h.app.state.callRoot;
  await h.$('[data-action="joinCall"]', root).fire('click'); await h.flush();
  assert.equal(h.controllers[0].tracks.has('audio'), true);
  assert.match(h.app.state.mediaError, /筆錄狀態更新結果不完整/);
  assert.doesNotMatch(h.app.state.mediaError, /攝影機/);
  sdk.cameraError = null;
  await h.controllers[0].setDevice('video', true);
  assert.match(h.$('[data-slot="mediaError"]', root).textContent, /筆錄狀態更新結果不完整/);
});

for (const authenticated of [false, true]) {
  test(`/admin.html boot ${authenticated ? 'restores admin workspace' : 'shows staff login'} without citizen capture`, async () => {
    const h = await harness({ pathname: '/admin.html', me: authenticated ? { user: { role: 'admin' } } : {}, cases: [caseItem('a')] });
    assert.equal(h.window.location.pathname, '/admin'); assert.equal(h.window.location.hash, '#admin');
    assert.equal(h.$(authenticated ? '#adminPanel' : '#staffPanel').classList.contains('active'), true);
    assert.equal(h.$('#citizenPanel').classList.contains('active'), false);
    assert.equal(h.controllers.length, 0); assert.equal(h.app.state.currentCase, null);
    assert.equal(Boolean(h.$('#createUserForm')), authenticated);
    assert.equal(h.requests.some((item) => /citizen\/start|agora-token|\/statement/.test(item.url)), false);
  });
}

for (const status of ['pending', 'closed']) {
  test(`restored ${status} citizen boot shows notice without workspace, token or capture`, async () => {
    const h = await harness({ me: { case: caseItem('a', status) } });
    assert.match(h.$('#citizenStatus').textContent, status === 'pending' ? /尚待審核/ : /已結案/);
    assert.equal(h.app.state.currentCase, null); assert.equal(h.app.state.callRoot, null);
    assert.equal(h.$('#citizenWorkspace').classList.contains('hidden'), true);
    assert.equal(h.controllers.length, 0); assert.equal(h.timers.size, 0);
    assert.deepEqual(h.requests.map((item) => item.url), ['/api/me']);
  });
}

test('no legacy Agora/subscription/demo/recording lifecycle remains in app', () => {
  assert.doesNotMatch(source, /MediaRecorder|captureStream|RTCPeerConnection|createDemoSocket|demoApi|createDemoVideoStream|AgoraRTC\.create|subscribeRemoteUser|socket\.(on|emit)|停止接收/);
  assert.doesNotMatch(source, /queryPath\('\/api\/me'.*(staff-login|citizen-start)/);
});