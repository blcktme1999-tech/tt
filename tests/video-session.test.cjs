'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ReportVideoSession = require('../public/video-session.js');

// A deliberately small DOM: no browser packages and no string-selector play mocks.
class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
  }
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentNode) {
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    for (const child of children) this.appendChild(child);
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    const slot = selector.match(/^\[data-slot="?([^"\]]+)"?\]$/);
    return slot ? this.dataset.slot === slot[1] : this.tagName === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(child) { return this === child || this.children.some((item) => item.contains(child)); }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
}

function makeRoot(reverse = false) {
  const doc = { createElement: (tag) => new Element(tag, doc) };
  const root = doc.createElement('section');
  const append = (parent, slot, className = '') => {
    const element = doc.createElement('div');
    element.dataset.slot = slot;
    element.className = className;
    parent.appendChild(element);
    return element;
  };
  const grid = append(root, 'videoGrid');
  const local = append(grid, 'localTile', 'video-tile');
  const wrapper = append(local, reverse ? 'localPlayer' : 'localVideoSlot', 'video-slot');
  const player = append(wrapper, reverse ? 'localVideoSlot' : 'localPlayer', 'video-player');
  append(local, 'localLabel', 'video-label');
  const placeholder = append(grid, 'remotePlaceholder', 'video-tile');
  return { root, grid, local, player, placeholder };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function makeTrack(kind) {
  return {
    trackMediaType: kind, plays: [], stops: 0, closes: 0,
    play(...args) {
      this.plays.push(args);
      if (kind === 'video') {
        assert.ok(args[0] instanceof Element, 'Agora video play requires HTMLElement');
        assert.deepEqual(args[1], { fit: 'contain' });
        args[0].appendChild(args[0].ownerDocument.createElement('video'));
      } else assert.equal(args.length, 0);
    },
    stop() { this.stops++; },
    close() { this.closes++; }
  };
}

function makeUser(uid, video = false, audio = false) {
  return { uid, hasVideo: video, hasAudio: audio,
    videoTrack: video ? makeTrack('video') : null,
    audioTrack: audio ? makeTrack('audio') : null };
}

function setup(t, options = {}) {
  const clients = [], created = [], errors = [], changes = [], tokenCalls = [];
  const auth = { appId: 'app', channelName: 'room', uid: 'agent-server-auth', token: 'token-1' };
  const sdk = {
    createClient() {
      const handlers = new Map();
      const client = {
        handlers, remoteUsers: options.users || [], joins: [], leaves: 0, emitting: false,
        publishes: [], unpublishes: [], subscribes: [], renewals: [],
        on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); },
        off(event, fn) { handlers.get(event)?.delete(fn); },
        emit(event, ...args) {
          this.emitting = true;
          try { return Promise.all([...(handlers.get(event) || [])].map((fn) => fn(...args))); }
          finally { this.emitting = false; }
        },
        async join(...args) { this.joins.push(args); if (options.join) await options.join(this); return args[3]; },
        async leave() {
          assert.equal(this.emitting, false, 'leave must not run reentrantly inside an SDK event');
          this.leaves++;
          await this.emit('connection-state-change', 'DISCONNECTED', 'DISCONNECTING', 'LEAVE');
          if (options.leave) await options.leave(this);
        },
        async publish(track) { this.publishes.push(track); if (options.publish) await options.publish(track); },
        async unpublish(track) { this.unpublishes.push(track); if (options.unpublish) await options.unpublish(track); },
        async subscribe(user, kind) { this.subscribes.push([user.uid, kind]); if (options.subscribe) await options.subscribe(user, kind); },
        async renewToken(token) { this.renewals.push(token); }
      };
      clients.push(client);
      return client;
    },
    async createCameraVideoTrack() {
      const track = makeTrack('video'); created.push(track);
      return options.camera ? options.camera(track) : track;
    },
    async createMicrophoneAudioTrack() {
      const track = makeTrack('audio'); created.push(track);
      return options.microphone ? options.microphone(track) : track;
    }
  };
  const previous = globalThis.AgoraRTC;
  globalThis.AgoraRTC = sdk;
  const controller = new ReportVideoSession({
    getToken: async (caseId) => { tokenCalls.push(caseId); return options.token ? options.token(caseId, tokenCalls.length) : auth; },
    onError: (error) => errors.push(error),
    onChange: (session) => changes.push({ status: session.status, connected: session.connected,
      busy: session.busy, audio: session.tracks.has('audio'), video: session.tracks.has('video') })
  });
  t.after(async () => {
    await controller.disconnect().catch(() => {});
    globalThis.AgoraRTC = previous;
  });
  return { controller, clients, created, errors, changes, auth, tokenCalls, sdk, ...makeRoot() };
}

test('receive-only join is idempotent, requests no devices, and preserves server UID', async (t) => {
  const h = setup(t);
  const first = h.controller.connect('case-1', h.root);
  const second = h.controller.connect('case-1', h.root);
  assert.equal(h.controller.busy, true);
  await Promise.all([first, second]);
  assert.equal(h.clients.length, 1);
  assert.equal(h.tokenCalls.length, 1);
  assert.deepEqual(h.clients[0].joins[0], ['app', 'room', 'token-1', 'agent-server-auth']);
  assert.equal(h.created.length, 0);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.busy, false);
  assert.equal(h.placeholder.hidden, false);
  assert.equal(h.grid.children.length, 2);
  assert.ok(h.changes.some((change) => change.status === 'connecting' && change.busy));
});

test('audio only never requests camera; disabling devices leaves room and receiver intact', async (t) => {
  const user = makeUser('citizen-one', true, true);
  const h = setup(t, { users: [user] });
  await h.controller.connect('case', h.root);
  await flush();
  await Promise.all([h.controller.setDevice('audio', true), h.controller.setDevice('audio', true)]);
  assert.deepEqual(h.created.map((track) => track.trackMediaType), ['audio']);
  assert.equal(h.controller.hasLocalMedia, true);
  assert.equal(h.clients[0].publishes.length, 1);
  await h.controller.setDevice('video', true);
  await h.controller.setDevice('video', false);
  assert.equal(h.controller.hasLocalMedia, true);
  await h.controller.setDevice('audio', false);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(h.controller.connected, true);
  assert.equal(h.clients[0].leaves, 0);
  assert.equal(user.videoTrack.stops, 0);
  assert.equal(user.audioTrack.stops, 0);
  assert.ok(h.created.every((track) => track.closes === 1));
  assert.equal(h.player.children.length, 0);
});

test('multiple users get independent containers, correct audio labels, and no receive-only tile', async (t) => {
  const users = [makeUser('citizen-one', true), makeUser('citizen-two', true),
    makeUser('admin-three', false, true), makeUser('citizen-four', false, true), makeUser('agent-listener')];
  const h = setup(t, { users });
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.grid.children.length, 6); // local + hidden waiting + 4 publishers
  assert.equal(h.placeholder.hidden, true);
  const firstPlayer = users[0].videoTrack.plays[0][0];
  const secondPlayer = users[1].videoTrack.plays[0][0];
  assert.notEqual(firstPlayer, secondPlayer);
  assert.equal(firstPlayer.querySelector('video').muted, true);
  assert.equal(secondPlayer.querySelector('video').autoplay, true);
  assert.equal(secondPlayer.querySelector('video').playsInline, true);
  const labels = h.root.querySelectorAll('.video-label').map((label) => label.textContent);
  assert.ok(labels.includes('客服（僅語音）'));
  assert.ok(labels.includes('民眾（僅語音）'));
  await h.clients[0].emit('user-left', users[0]);
  assert.equal(users[0].videoTrack.stops, 1);
  assert.equal(secondPlayer.children.length, 1);
  for (const user of users.slice(1)) await h.clients[0].emit('user-left', user);
  assert.equal(h.grid.children.length, 2);
  assert.equal(h.placeholder.hidden, false);
});

test('subscriptions deduplicate during join/events and after successful subscribe', async (t) => {
  const gate = deferred();
  const user = makeUser('citizen-one', true);
  const h = setup(t, { users: [user], subscribe: () => gate.promise });
  await h.controller.connect('case', h.root);
  const duplicate = h.clients[0].emit('user-published', user, 'video');
  await flush();
  assert.equal(h.clients[0].subscribes.length, 1);
  gate.resolve();
  await duplicate;
  await h.clients[0].emit('user-published', user, 'video');
  assert.equal(h.clients[0].subscribes.length, 1);
  assert.equal(user.videoTrack.plays.length, 1);
});

test('unpublish removes only that media; re-publish subscribes anew', async (t) => {
  const user = makeUser('agent-one', true, true);
  const h = setup(t, { users: [user] });
  await h.controller.connect('case', h.root);
  await flush();
  const old = user.videoTrack;
  await h.clients[0].emit('user-unpublished', user, 'video');
  assert.equal(old.stops, 1);
  assert.equal(user.audioTrack.stops, 0);
  assert.equal(h.placeholder.hidden, true);
  assert.ok(h.root.querySelectorAll('.video-label').some((label) => label.textContent === '客服（僅語音）'));
  user.videoTrack = makeTrack('video');
  await h.clients[0].emit('user-published', user, 'video');
  assert.equal(user.videoTrack.plays.length, 1);
  assert.equal(h.clients[0].subscribes.length, 3);
  await h.clients[0].emit('user-unpublished', user, 'video');
  await h.clients[0].emit('user-unpublished', user, 'audio');
  assert.equal(h.grid.children.length, 2);
  assert.equal(h.placeholder.hidden, false);
});

test('late subscribe after unpublish is stopped and cannot overwrite a re-publication', async (t) => {
  const gate = deferred();
  const oldTrack = makeTrack('video');
  const newTrack = makeTrack('video');
  const user = makeUser('citizen-one', true);
  let calls = 0;
  const h = setup(t, { subscribe: async (target) => {
    if (++calls === 1) { await gate.promise; target.videoTrack = oldTrack; }
    else target.videoTrack = newTrack;
  } });
  await h.controller.connect('case', h.root);
  const oldSubscribe = h.clients[0].emit('user-published', user, 'video');
  await flush();
  await h.clients[0].emit('user-unpublished', user, 'video');
  const freshSubscribe = h.clients[0].emit('user-published', user, 'video');
  assert.equal(h.clients[0].subscribes.length, 1);
  gate.resolve();
  await Promise.all([oldSubscribe, freshSubscribe]);
  assert.equal(oldTrack.plays.length, 0);
  assert.equal(oldTrack.stops, 1);
  assert.equal(newTrack.plays.length, 1);
  assert.equal(h.clients[0].subscribes.length, 2);
  assert.equal(h.grid.children.length, 3);
});

test('user-left invalidates a late subscribe, including when the same UID returns', async (t) => {
  const gate = deferred();
  const old = makeUser('agent-one', false, true);
  const fresh = makeUser('agent-one', false, true);
  const h = setup(t, { subscribe: (user) => user === old ? gate.promise : undefined });
  await h.controller.connect('case', h.root);
  const pending = h.clients[0].emit('user-published', old, 'audio');
  await flush();
  await h.clients[0].emit('user-left', old);
  const returned = h.clients[0].emit('user-published', fresh, 'audio');
  gate.resolve();
  await Promise.all([pending, returned]);
  assert.equal(old.audioTrack.plays.length, 0);
  assert.equal(old.audioTrack.stops, 1);
  assert.equal(fresh.audioTrack.plays.length, 1);
});

test('disconnect does not wait for subscribe; late completion never plays or regenerates tiles', async (t) => {
  const gate = deferred();
  const user = makeUser('citizen-one', true);
  const h = setup(t, { subscribe: () => gate.promise });
  await h.controller.connect('case', h.root);
  const pending = h.clients[0].emit('user-published', user, 'video');
  await flush();
  await h.controller.disconnect();
  gate.resolve();
  await pending;
  assert.equal(user.videoTrack.plays.length, 0);
  assert.equal(user.videoTrack.stops, 1);
  assert.equal(h.grid.children.length, 2);
  assert.equal(h.controller.client, null);
  assert.equal(h.errors.length, 0);
});

test('failed publish unpublishes partial work, closes track, keeps receiver, and allows retry', async (t) => {
  let fail = true;
  const h = setup(t, { publish: () => { if (fail) throw new Error('publish failed'); } });
  await h.controller.connect('case', h.root);
  await assert.rejects(h.controller.setDevice('video', true), /publish failed/);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.clients[0].unpublishes[0], h.created[0]);
  assert.equal(h.controller.tracks.size, 0);
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.busy, false);
  assert.equal(h.controller.status, 'error');
  assert.equal(h.errors.length, 1);
  fail = false;
  await h.controller.setDevice('video', true);
  assert.equal(h.controller.tracks.get('video'), h.created[1]);
  await h.controller.disconnect();
  assert.equal(h.created[1].closes, 1);
  assert.equal(h.player.children.length, 0);
});

test('publishBoth uses independent devices and still attempts audio when camera fails', async (t) => {
  const h = setup(t, { camera: () => { throw new Error('camera unavailable'); } });
  await h.controller.connect('case', h.root);
  await assert.rejects(h.controller.publishBoth(), /camera unavailable/);
  assert.equal(h.controller.tracks.has('video'), false);
  assert.equal(h.controller.tracks.has('audio'), true);
  assert.equal(h.controller.busy, false);
  assert.equal(h.clients[0].publishes.length, 1);
});

test('rapid enable/disable/enable is serialized without duplicate captures', async (t) => {
  const h = setup(t);
  await h.controller.connect('case', h.root);
  await Promise.all([
    h.controller.setDevice('video', true), h.controller.setDevice('video', true),
    h.controller.setDevice('video', false), h.controller.setDevice('video', true)
  ]);
  assert.equal(h.created.length, 2);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.created[1].closes, 0);
  assert.equal(h.controller.tracks.get('video'), h.created[1]);
  assert.equal(h.controller.busy, false);
});

test('disconnect cancels capture and queued devices, closes late track, then reconnects', async (t) => {
  const gate = deferred();
  const h = setup(t, { camera: async (track) => { await gate.promise; return track; } });
  await h.controller.connect('old', h.root);
  const capture = h.controller.setDevice('video', true);
  const captureRejected = assert.rejects(capture, { name: 'AbortError' });
  await flush();
  const queued = h.controller.setDevice('audio', true);
  const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
  const disconnect = h.controller.disconnect();
  const reconnect = h.controller.connect('new', h.root);
  assert.equal(h.controller.busy, true);
  gate.resolve();
  await Promise.all([captureRejected, queuedRejected, disconnect, reconnect]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.clients[0].publishes.length, 0);
  assert.equal(h.clients[0].leaves, 1);
  assert.equal(h.controller.caseId, 'new');
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.busy, false);
  assert.equal(h.errors.length, 0);
});

test('disconnect during publish closes partial track and never installs local playback', async (t) => {
  const gate = deferred();
  const h = setup(t, { publish: () => gate.promise });
  await h.controller.connect('case', h.root);
  const rejected = assert.rejects(h.controller.setDevice('video', true), { name: 'AbortError' });
  await flush();
  const leaving = h.controller.disconnect();
  gate.resolve();
  await Promise.all([rejected, leaving]);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.created[0].plays.length, 0);
  assert.equal(h.clients[0].unpublishes.length, 1);
  assert.equal(h.controller.hasLocalMedia, false);
});

test('disconnect during token request never creates or joins a client', async (t) => {
  const gate = deferred();
  const h = setup(t, { token: () => gate.promise });
  const rejected = assert.rejects(h.controller.connect('case', h.root), { name: 'AbortError' });
  await flush();
  const leaving = h.controller.disconnect();
  gate.resolve(h.auth);
  await Promise.all([rejected, leaving]);
  assert.equal(h.clients.length, 0);
  assert.equal(h.controller.status, 'idle');
  assert.equal(h.controller.root, null);
});

test('disconnect during join leaves old client and removes its listeners', async (t) => {
  const gate = deferred();
  const h = setup(t, { join: () => gate.promise });
  const rejected = assert.rejects(h.controller.connect('case', h.root), { name: 'AbortError' });
  await flush();
  const leaving = h.controller.disconnect();
  gate.resolve();
  await Promise.all([rejected, leaving]);
  assert.equal(h.clients[0].leaves, 1);
  assert.ok([...h.clients[0].handlers.values()].every((listeners) => listeners.size === 0));
  assert.equal(h.controller.connected, false);
});

test('failed join cleans state and permits retry', async (t) => {
  let fail = true;
  const h = setup(t, { join: () => { if (fail) throw new Error('join failed'); } });
  await assert.rejects(h.controller.connect('case', h.root), /join failed/);
  assert.equal(h.controller.root, null);
  assert.equal(h.controller.caseId, null);
  assert.equal(h.controller.client, null);
  assert.equal(h.controller.busy, false);
  assert.equal(h.controller.status, 'error');
  assert.equal(h.clients[0].leaves, 1);
  fail = false;
  await h.controller.connect('case', h.root);
  assert.equal(h.clients.length, 2);
  assert.equal(h.controller.connected, true);
});

test('same case with new root reattaches video, preserves audio, and does not rejoin', async (t) => {
  const user = makeUser('citizen-one', true, true);
  const h = setup(t, { users: [user] });
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  await flush();
  const newDOM = makeRoot(true);
  await h.controller.connect('case', newDOM.root);
  assert.equal(h.clients.length, 1);
  assert.equal(h.clients[0].joins.length, 1);
  assert.equal(h.created.length, 2);
  assert.equal(h.player.children.length, 0);
  assert.equal(h.grid.children.length, 2);
  assert.equal(h.placeholder.hidden, false);
  assert.equal(h.controller.tracks.get('video').plays.at(-1)[0], newDOM.player);
  assert.ok(newDOM.root.contains(user.videoTrack.plays.at(-1)[0]));
  assert.equal(user.audioTrack.plays.length, 1);
  assert.equal(user.audioTrack.stops, 0);
  assert.equal(newDOM.placeholder.hidden, true);
  await h.controller.disconnect();
  assert.equal(newDOM.player.children.length, 0);
  assert.equal(newDOM.grid.children.length, 2);
  assert.equal(user.audioTrack.stops, 1);
});

test('switching case closes old devices, leaves room, and joins receive-only', async (t) => {
  const h = setup(t);
  await h.controller.connect('first', h.root);
  await h.controller.publishBoth();
  await h.controller.connect('second', h.root);
  assert.equal(h.clients[0].leaves, 1);
  assert.equal(h.clients.length, 2);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.ok(h.created.every((track) => track.closes === 1));
});

test('subscription errors notify onError, stay retryable, and do not fail receive-only join', async (t) => {
  let fail = true;
  const user = makeUser('citizen-one', true);
  const h = setup(t, { users: [user], subscribe: () => { if (fail) throw new Error('subscribe failed'); } });
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.connected, true);
  assert.equal(h.errors.length, 1);
  assert.equal(h.placeholder.hidden, false);
  fail = false;
  await h.clients[0].emit('user-published', user, 'video');
  assert.equal(user.videoTrack.plays.length, 1);
});

test('SDK autoplay failure chains/restores callback; resumeAudio replays all tracks synchronously', async (t) => {
  const users = [makeUser('citizen-one', false, true), makeUser('agent-two', false, true)];
  const h = setup(t, { users });
  let previousCalls = 0;
  const previous = () => previousCalls++;
  h.sdk.onAutoplayFailed = previous;
  await h.controller.connect('case', h.root);
  await flush();
  h.sdk.onAutoplayFailed();
  assert.equal(previousCalls, 1);
  assert.equal(h.controller.audioBlocked, true);
  const resumed = h.controller.resumeAudio();
  assert.ok(users.every((user) => user.audioTrack.plays.length === 2));
  assert.equal(await resumed, true);
  assert.equal(h.controller.audioBlocked, false);
  await h.controller.disconnect();
  assert.equal(h.sdk.onAutoplayFailed, previous);
});

test('rejected audio playback is reported without unhandled rejections and can be resumed', async (t) => {
  const user = makeUser('citizen-one', false, true);
  user.audioTrack.play = () => Promise.reject(new Error('gesture required'));
  const h = setup(t, { users: [user] });
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.audioBlocked, true);
  assert.equal(h.errors[0].message, 'gesture required');
  user.audioTrack.play = () => {};
  assert.equal(await h.controller.resumeAudio(), true);
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.controller.lastError, null);
});

test('token renewal deduplicates, preserves exact UID, and rejects changed identity', async (t) => {
  const gate = deferred();
  let changed = false;
  const h = setup(t, { token: (_case, count) => count === 1 ? h.auth :
    changed ? { ...h.auth, uid: 'agent-different', token: 'bad' } : gate.promise });
  await h.controller.connect('case', h.root);
  const a = h.clients[0].emit('token-privilege-will-expire');
  const b = h.clients[0].emit('token-privilege-will-expire');
  await flush();
  assert.deepEqual(h.tokenCalls, ['case', 'case']);
  gate.resolve({ ...h.auth, token: 'token-2' });
  await Promise.all([a, b]);
  assert.deepEqual(h.clients[0].renewals, ['token-2']);
  assert.equal(h.clients[0].joins[0][3], h.auth.uid);
  changed = true;
  await h.clients[0].emit('token-privilege-will-expire');
  assert.deepEqual(h.clients[0].renewals, ['token-2']);
  assert.match(h.errors.at(-1).message, /UID/);
});

test('late token renewal after disconnect is ignored', async (t) => {
  const gate = deferred();
  const h = setup(t, { token: (_case, count) => count === 1 ? h.auth : gate.promise });
  await h.controller.connect('case', h.root);
  const renewing = h.clients[0].emit('token-privilege-will-expire');
  await flush();
  await h.controller.disconnect();
  gate.resolve({ ...h.auth, token: 'too-late' });
  await renewing;
  assert.equal(h.clients[0].renewals.length, 0);
  assert.equal(h.errors.length, 0);
});

test('unpublish/leave errors still release tracks, UI, listeners and allow another connection', async (t) => {
  let fail = true;
  const h = setup(t, {
    unpublish: () => { if (fail) throw new Error('unpublish failed'); },
    leave: () => { if (fail) throw new Error('leave failed'); }
  });
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  await assert.rejects(h.controller.setDevice('video', false), /unpublish failed/);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.controller.tracks.has('video'), false);
  await assert.rejects(h.controller.disconnect(), /leave failed/);
  assert.equal(h.created[1].closes, 1);
  assert.equal(h.controller.client, null);
  assert.equal(h.controller.root, null);
  assert.equal(h.controller.busy, false);
  assert.ok([...h.clients[0].handlers.values()].every((listeners) => listeners.size === 0));
  fail = false;
  await h.controller.connect('case', h.root);
  assert.equal(h.controller.connected, true);
});

test('invalid media/root and missing SDK fail clearly without wedging the queue', async (t) => {
  const h = setup(t);
  await assert.rejects(h.controller.connect('case', null), /videoGrid/);
  globalThis.AgoraRTC = undefined;
  await assert.rejects(h.controller.connect('case', h.root), /SDK/);
  assert.equal(h.controller.caseId, null);
  globalThis.AgoraRTC = h.sdk;
  await h.controller.connect('case', h.root);
  await assert.rejects(h.controller.setDevice('screen', true), TypeError);
  assert.equal(h.controller.busy, false);
});

test('browser script exposes window.ReportVideoSession without CommonJS', () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const context = { window: {} };
  runInNewContext(readFileSync(require.resolve('../public/video-session.js'), 'utf8'), context);
  assert.equal(typeof context.window.ReportVideoSession, 'function');
  const session = new context.window.ReportVideoSession({ getToken: async () => ({}) });
  assert.equal(session.status, 'idle');
  assert.equal(session.connected, false);
});

test('one pending media subscription does not block other users or audio', async (t) => {
  const gate = deferred();
  const blocked = makeUser('citizen-one', true, true);
  const other = makeUser('citizen-two', true);
  const h = setup(t, { users: [blocked, other], subscribe: (user, kind) =>
    user === blocked && kind === 'video' ? gate.promise : undefined });
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(blocked.videoTrack.plays.length, 0);
  assert.equal(blocked.audioTrack.plays.length, 1);
  assert.equal(other.videoTrack.plays.length, 1);
  gate.resolve();
  await flush();
  assert.equal(blocked.videoTrack.plays.length, 1);
});

test('late subscribe rejection after unpublish does not erase a new publication or report stale errors', async (t) => {
  const gate = deferred();
  const user = makeUser('citizen-one', true);
  let calls = 0;
  const h = setup(t, { subscribe: () => ++calls === 1 ? gate.promise : undefined });
  await h.controller.connect('case', h.root);
  const old = h.clients[0].emit('user-published', user, 'video');
  await flush();
  await h.clients[0].emit('user-unpublished', user, 'video');
  const fresh = h.clients[0].emit('user-published', user, 'video');
  gate.reject(new Error('obsolete subscription'));
  await Promise.all([old, fresh]);
  assert.equal(h.errors.length, 0);
  assert.equal(user.videoTrack.plays.length, 1);
  assert.equal(h.placeholder.hidden, true);
});

test('late local playback failure after camera off is ignored; synchronous active failure stays visible', async (t) => {
  const gate = deferred();
  let late = true;
  const h = setup(t, { camera: (track) => {
    track.play = () => { if (late) return gate.promise; throw new Error('active player failure'); };
    return track;
  } });
  await h.controller.connect('case', h.root);
  await h.controller.setDevice('video', true);
  await h.controller.setDevice('video', false);
  gate.reject(new Error('obsolete player failure'));
  await flush();
  assert.equal(h.errors.length, 0);
  late = false;
  await h.controller.setDevice('video', true);
  assert.equal(h.controller.status, 'error');
  assert.equal(h.controller.lastError.message, 'active player failure');
  assert.equal(h.controller.tracks.has('video'), true); // Publication itself succeeded.
});

test('SDK autoplay hook supports overlapping controllers and restores only when last leaves', async (t) => {
  const h = setup(t);
  const original = () => {};
  h.sdk.onAutoplayFailed = original;
  const other = new ReportVideoSession({ getToken: async () => h.auth });
  t.after(() => other.disconnect());
  await h.controller.connect('first', h.root);
  await other.connect('second', makeRoot().root);
  await h.controller.disconnect();
  assert.notEqual(h.sdk.onAutoplayFailed, original);
  h.sdk.onAutoplayFailed();
  assert.equal(other.audioBlocked, true);
  assert.equal(h.controller.audioBlocked, false);
  await other.disconnect();
  assert.equal(h.sdk.onAutoplayFailed, original);
});

test('callbacks that throw cannot break connection or cleanup', async (t) => {
  const h = setup(t, { publish: () => { throw new Error('publish failed'); } });
  h.controller.onChange = () => { throw new Error('UI failure'); };
  h.controller.onError = () => { throw new Error('UI error handler failure'); };
  await h.controller.connect('case', h.root);
  await assert.rejects(h.controller.setDevice('video', true), /publish failed/);
  await h.controller.disconnect();
  assert.equal(h.controller.busy, false);
  assert.equal(h.controller.client, null);
  assert.equal(h.created[0].closes, 1);
});

test('same-case connect retries failed/missing remote tracks without rejoining or duplicating pending/successful tracks', async (t) => {
  const user = makeUser('citizen-one', true, true), newcomer = makeUser('citizen-two', true);
  const gate = deferred();
  let fail = true;
  const h = setup(t, { users: [user], subscribe: (_user, kind) => {
    if (kind === 'video') {
      if (fail) throw new Error('video subscription failed');
      return gate.promise;
    }
  } });
  await h.controller.connect('case', h.root);
  await flush();
  const failure = h.controller.lastError;
  assert.match(failure.message, /subscription failed/);
  assert.equal(user.audioTrack.plays.length, 1);
  fail = false;
  h.clients[0].remoteUsers.push(newcomer);
  const replacement = makeRoot();
  await h.controller.connect('case', replacement.root);
  await h.controller.connect('case', replacement.root);
  await flush();
  assert.equal(h.controller.lastError, failure, 'starting retry is not recovery');
  assert.equal(h.controller.status, 'error');
  assert.equal(h.controller.busy, false, 'connect must not wait on remote subscriptions');
  assert.deepEqual(h.clients[0].subscribes, [
    [user.uid, 'video'], [user.uid, 'audio'], [user.uid, 'video'], [newcomer.uid, 'video']
  ]);
  gate.resolve();
  await flush();
  assert.equal(h.controller.lastError, null);
  assert.equal(h.controller.status, 'connected');
  assert.ok(replacement.root.contains(user.videoTrack.plays[0][0]));
  assert.equal(user.audioTrack.plays.length, 1);
  await h.controller.connect('case', replacement.root);
  assert.equal(h.clients[0].subscribes.length, 4);
  assert.equal(h.clients.length, 1);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.created.length, 0);
});

test('retry that still has no remote track remains an error until an actual track is subscribed', async (t) => {
  const user = makeUser('citizen-one', true);
  user.videoTrack = null;
  const h = setup(t, { users: [user] });
  await h.controller.connect('case', h.root);
  await flush();
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.clients[0].subscribes.length, 2);
  assert.equal(h.controller.status, 'error');
  assert.equal(h.errors.length, 2);
  user.videoTrack = makeTrack('video');
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.controller.lastError, null);
  assert.equal(user.videoTrack.plays.length, 1);
});

test('recovering one failed subscription preserves other subscription failures', async (t) => {
  const user = makeUser('citizen-one', true, true);
  const failures = new Set(['video', 'audio']);
  const h = setup(t, { users: [user], subscribe: (_user, kind) => {
    if (failures.has(kind)) throw new Error(`${kind} failed`);
  } });
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.lastError.message, 'audio failed');
  failures.delete('audio');
  await h.clients[0].emit('user-published', user, 'audio');
  assert.equal(h.controller.lastError.message, 'video failed');
  assert.equal(h.controller.status, 'error');
  failures.clear();
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.lastError, null);
  assert.equal(h.controller.status, 'connected');
});

test('successful subscription retry does not erase unrelated device or playback errors', async (t) => {
  let fail = true;
  const user = makeUser('citizen-one', true);
  const h = setup(t, { users: [user], subscribe: () => { if (fail) throw new Error('subscribe failed'); },
    camera: () => { throw new Error('camera denied'); } });
  await h.controller.connect('case', h.root);
  await flush();
  await assert.rejects(h.controller.setDevice('video', true), /camera denied/);
  const deviceError = h.controller.lastError;
  fail = false;
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(user.videoTrack.plays.length, 1);
  assert.equal(h.controller.lastError, deviceError);
  assert.equal(h.controller.status, 'error');
  h.sdk.onAutoplayFailed();
  const playbackError = h.controller.lastError;
  await h.controller.connect('case', h.root);
  assert.equal(h.controller.lastError, playbackError);
  assert.equal(h.controller.audioBlocked, true);
});

test('SDK reconnect reports offline accurately, preserves consented tracks, and never automatically retries subscriptions', async (t) => {
  const user = makeUser('citizen-one', true), newcomer = makeUser('citizen-two', false, true);
  let fail = true;
  const h = setup(t, { users: [user], subscribe: () => { if (fail) throw new Error('subscribe failed'); } });
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  await flush();
  const client = h.clients[0], oldTracks = [...h.controller.tracks.values()];
  await client.emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
  assert.equal(h.controller.connected, false);
  assert.equal(h.controller.status, 'reconnecting');
  assert.equal(await h.controller.resumeAudio(), false);
  fail = false;
  client.remoteUsers.push(newcomer);
  await client.emit('user-published', user, 'video');
  await client.emit('user-published', newcomer, 'audio');
  await client.emit('connection-state-change', 'RECONNECTING', 'RECONNECTING');
  await flush();
  assert.equal(client.subscribes.length, 1);
  assert.equal(client.leaves, 0);
  assert.equal(h.clients.length, 1);
  await client.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.status, 'connected');
  assert.equal(client.subscribes.length, 1, 'SDK recovery itself must not rescan');
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(client.subscribes.length, 3);
  assert.equal(h.clients.length, 1);
  assert.equal(h.created.length, 2);
  assert.equal(client.publishes.length, 2);
  assert.ok(oldTracks.every((track) => track.closes === 0));
  assert.ok(h.changes.some((change) => !change.connected && change.status === 'reconnecting'));
});

test('explicit connect while SDK reconnects cleans old client and rejoins receive-only', async (t) => {
  const h = setup(t);
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  const old = h.clients[0];
  await old.emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
  await h.controller.connect('case', h.root);
  assert.equal(old.leaves, 1);
  assert.ok([...old.handlers.values()].every((handlers) => handlers.size === 0));
  assert.equal(h.clients.length, 2);
  assert.ok(h.created.every((track) => track.closes === 1));
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(h.clients[1].publishes.length, 0);
});

test('DISCONNECTED reports reason, does not leave reentrantly, and requires fresh explicit connect', async (t) => {
  const h = setup(t);
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  const old = h.clients[0];
  await old.emit('connection-state-change', 'DISCONNECTED', 'CONNECTED', 'NETWORK_ERROR');
  assert.equal(h.controller.connected, false);
  assert.equal(h.controller.status, 'disconnected');
  assert.equal(h.controller.lastError.code, 'CONNECTION_DISCONNECTED');
  assert.match(h.controller.lastError.message, /NETWORK_ERROR/);
  assert.equal(h.errors.length, 1);
  assert.equal(old.leaves, 0);
  assert.equal(h.controller.hasLocalMedia, false);
  await old.emit('connection-state-change', 'CONNECTED', 'DISCONNECTED');
  assert.equal(h.controller.connected, false);
  assert.equal(h.controller.status, 'disconnected');
  await h.controller.connect('case', h.root);
  assert.equal(h.clients.length, 2);
  assert.equal(old.leaves, 1);
  assert.equal(h.controller.lastError, null);
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.clients[1].publishes.length, 0);
});

test('token expiry is terminal; explicit retry closes old tracks/listeners and stale events cannot touch new receiver', async (t) => {
  const h = setup(t);
  const previousAutoplay = () => {};
  h.sdk.onAutoplayFailed = previousAutoplay;
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  const old = h.clients[0], oldAutoplay = h.sdk.onAutoplayFailed;
  const saved = new Map([...old.handlers].map(([event, handlers]) => [event, [...handlers][0]]));
  assert.ok(saved.has('connection-state-change'));
  assert.ok(saved.has('token-privilege-did-expire'));
  await old.emit('token-privilege-did-expire');
  const failure = h.controller.lastError;
  assert.equal(failure.code, 'TOKEN_EXPIRED');
  assert.equal(h.controller.status, 'error');
  assert.equal(h.controller.connected, false);
  assert.equal(h.errors.length, 1);
  assert.equal(old.leaves, 0);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.ok(h.created.every((track) => track.closes === 1));
  assert.equal(h.player.children.length, 0);
  await old.emit('token-privilege-did-expire');
  await old.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
  await old.emit('token-privilege-will-expire');
  assert.equal(h.controller.connected, false);
  assert.equal(h.tokenCalls.length, 1);
  assert.equal(h.errors.length, 1);
  await h.controller.connect('case', h.root);
  assert.equal(h.clients.length, 2);
  assert.equal(old.leaves, 1);
  assert.ok([...old.handlers.values()].every((handlers) => handlers.size === 0));
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.controller.lastError, null);
  assert.equal(h.created.length, 2);
  assert.ok(h.created.every((track) => track.closes === 1));
  assert.equal(h.clients[1].publishes.length, 0);
  const changes = h.changes.length;
  const user = makeUser('citizen-stale', true);
  await saved.get('connection-state-change')('DISCONNECTED', 'CONNECTED', 'OLD');
  await saved.get('token-privilege-did-expire')();
  await saved.get('token-privilege-will-expire')();
  await saved.get('user-published')(user, 'video');
  await saved.get('user-unpublished')(user, 'video');
  await saved.get('user-left')(user);
  oldAutoplay();
  assert.equal(h.changes.length, changes);
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.lastError, null);
  assert.equal(h.errors.length, 1);
  assert.equal(old.subscribes.length, 0);
  assert.equal(h.clients[1].subscribes.length, 0);
  assert.equal(h.tokenCalls.length, 2);
  await h.controller.disconnect();
  assert.equal(h.sdk.onAutoplayFailed, previousAutoplay);
});

test('CONNECTED event cannot announce success before join resolves or mask a rejected join', async (t) => {
  const gate = deferred();
  const h = setup(t, { join: async (client) => {
    await client.emit('connection-state-change', 'CONNECTING', 'DISCONNECTED');
    await client.emit('connection-state-change', 'CONNECTED', 'CONNECTING');
    await gate.promise;
    throw new Error('join failed after event');
  } });
  const rejected = assert.rejects(h.controller.connect('case', h.root).then(() => h.controller.publishBoth()), /join failed/);
  await flush();
  assert.equal(h.controller.connected, false);
  assert.equal(h.controller.status, 'connecting');
  gate.resolve();
  await rejected;
  assert.equal(h.changes.some((change) => change.connected || change.status === 'connected'), false);
  assert.equal(h.created.length, 0);
  assert.equal(h.clients[0].leaves, 1);
});

for (const event of ['expired', 'DISCONNECTED', 'RECONNECTING']) {
  test(`${event} during join cannot be overwritten by late join success or publish devices`, async (t) => {
    const gate = deferred();
    let first = true;
    const h = setup(t, { join: () => { if (first) return gate.promise; } });
    const rejected = assert.rejects(h.controller.connect('case', h.root).then(() => h.controller.publishBoth()),
      event === 'expired' ? /過期/ : event === 'DISCONNECTED' ? /中斷/ : /尚未恢復/);
    await flush();
    const old = h.clients[0];
    if (event === 'expired') await old.emit('token-privilege-did-expire');
    else await old.emit('connection-state-change', event, 'CONNECTING');
    assert.equal(h.controller.connected, false);
    gate.resolve();
    await rejected;
    assert.equal(h.controller.connected, false);
    assert.equal(h.controller.status, 'error');
    assert.equal(h.created.length, 0);
    assert.equal(old.publishes.length, 0);
    assert.equal(old.leaves, 1);
    assert.equal(h.changes.some((change) => change.connected), false);
    first = false;
    await h.controller.connect('case', h.root);
    assert.equal(h.clients.length, 2);
    assert.equal(h.controller.connected, true);
    assert.equal(h.controller.hasLocalMedia, false);
  });
}

for (const event of ['expired', 'DISCONNECTED', 'RECONNECTING']) {
  test(`${event} cancels pending capture and queued device consent even if connection recovers first`, async (t) => {
    const gate = deferred();
    const h = setup(t, { camera: async (track) => { await gate.promise; return track; } });
    await h.controller.connect('case', h.root);
    const capture = assert.rejects(h.controller.setDevice('video', true), { name: 'AbortError' });
    const queued = assert.rejects(h.controller.setDevice('audio', true), { name: 'AbortError' });
    await flush();
    const old = h.clients[0];
    if (event === 'expired') await old.emit('token-privilege-did-expire');
    else await old.emit('connection-state-change', event, 'CONNECTED');
    if (event === 'RECONNECTING') await old.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
    gate.resolve();
    await Promise.all([capture, queued]);
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].closes, 1);
    assert.equal(h.created[0].plays.length, 0);
    assert.equal(old.publishes.length, 0);
    assert.equal(h.controller.hasLocalMedia, false);
    assert.equal(h.errors.length, event === 'RECONNECTING' ? 0 : 1);
    await h.controller.connect('case', h.root);
    assert.equal(h.controller.connected, true);
    assert.equal(h.controller.hasLocalMedia, false);
    assert.equal(h.created.length, 1);
    await h.controller.setDevice('audio', true);
    assert.equal(h.created.length, 2, 'fresh device consent still works');
  });
}

test('expiry during publish closes partial track once and retains expiry error after late SDK rejection', async (t) => {
  const gate = deferred();
  const h = setup(t, { publish: () => gate.promise });
  await h.controller.connect('case', h.root);
  const rejected = assert.rejects(h.controller.publishBoth(), { name: 'AbortError' });
  await flush();
  const old = h.clients[0];
  await old.emit('token-privilege-did-expire');
  const failure = h.controller.lastError;
  assert.equal(h.created[0].closes, 1);
  gate.reject(new Error('late publish rejection'));
  await rejected;
  assert.equal(h.controller.lastError, failure);
  assert.equal(h.errors.length, 1);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.created[0].plays.length, 0);
  assert.equal(old.unpublishes.length, 1);
  assert.equal(h.controller.connected, false);
  await h.controller.connect('case', h.root);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(h.clients[1].publishes.length, 0);
});

test('expiry invalidates in-flight renewal without renewing or overwriting expiry error', async (t) => {
  const gate = deferred();
  const h = setup(t, { token: (_case, count) => count === 2 ? gate.promise : h.auth });
  await h.controller.connect('case', h.root);
  const renewing = h.clients[0].emit('token-privilege-will-expire');
  await flush();
  await h.clients[0].emit('token-privilege-did-expire');
  const failure = h.controller.lastError;
  gate.resolve({ ...h.auth, token: 'too-late' });
  await renewing;
  assert.equal(h.clients[0].renewals.length, 0);
  assert.equal(h.controller.lastError, failure);
  assert.equal(h.controller.connected, false);
  await h.controller.connect('case', h.root);
  assert.equal(h.clients.length, 2);
  assert.equal(h.controller.lastError, null);
});

for (const rejects of [false, true]) {
  test(`expiry ignores late subscription ${rejects ? 'rejection' : 'success'} and preserves terminal state`, async (t) => {
    const gate = deferred();
    const user = makeUser('citizen-one', true);
    const h = setup(t, { users: [user], subscribe: () => gate.promise });
    await h.controller.connect('case', h.root);
    await h.clients[0].emit('token-privilege-did-expire');
    const failure = h.controller.lastError;
    if (rejects) gate.reject(new Error('late subscribe error'));
    else gate.resolve();
    await flush();
    assert.equal(user.videoTrack.plays.length, 0);
    assert.equal(user.videoTrack.stops, rejects ? 0 : 1);
    assert.equal(h.controller.lastError, failure);
    assert.equal(h.controller.status, 'error');
    assert.equal(h.controller.connected, false);
    assert.equal(h.errors.length, 1);
  });
}

test('pending subscription is invalidated during reconnect and only explicit connect retries after SDK recovery', async (t) => {
  const gate = deferred();
  const user = makeUser('citizen-one', true);
  let first = true;
  const h = setup(t, { users: [user], subscribe: () => { if (first) return gate.promise; } });
  await h.controller.connect('case', h.root);
  const client = h.clients[0];
  const beforeReconnect = h.changes.length;
  await client.emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
  assert.ok(h.changes.slice(beforeReconnect).every((change) => !change.connected && change.status === 'reconnecting'));
  gate.resolve();
  await flush();
  assert.equal(user.videoTrack.plays.length, 0);
  assert.equal(user.videoTrack.stops, 1);
  assert.equal(h.controller.status, 'reconnecting');
  assert.equal(h.controller.lastError, null);
  await client.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
  assert.equal(client.subscribes.length, 1);
  first = false;
  user.videoTrack = makeTrack('video');
  await h.controller.connect('case', h.root);
  await flush();
  assert.equal(client.subscribes.length, 2);
  assert.equal(user.videoTrack.plays.length, 1);
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.clients.length, 1);
});

test('device consent can be revoked while reconnecting without starting a client or restoring connected status', async (t) => {
  const h = setup(t);
  await h.controller.connect('case', h.root);
  await h.controller.publishBoth();
  const client = h.clients[0];
  await client.emit('connection-state-change', 'RECONNECTING', 'CONNECTED');
  await h.controller.setDevice('video', false);
  await h.controller.setDevice('audio', false);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(h.controller.connected, false);
  assert.equal(h.controller.status, 'reconnecting');
  assert.ok(h.created.every((track) => track.closes === 1));
  assert.equal(client.unpublishes.length, 2);
  await assert.rejects(h.controller.setDevice('video', true), /先連線/);
  assert.equal(h.created.length, 2);
  assert.equal(h.controller.status, 'reconnecting');
  await client.emit('connection-state-change', 'CONNECTED', 'RECONNECTING');
  assert.equal(h.controller.connected, true);
  assert.equal(h.controller.hasLocalMedia, false);
  assert.equal(client.publishes.length, 2);
  assert.equal(h.clients.length, 1);
});

test('normal SDK join events retain early remote subscriptions and only report connected after join succeeds', async (t) => {
  const gate = deferred();
  const user = makeUser('citizen-one', true);
  const h = setup(t, { users: [user], join: async (client) => {
    await client.emit('connection-state-change', 'CONNECTING', 'DISCONNECTED');
    await client.emit('user-published', user, 'video');
    await client.emit('connection-state-change', 'CONNECTED', 'CONNECTING');
    await gate.promise;
  } });
  const connecting = h.controller.connect('case', h.root);
  await flush();
  assert.equal(h.controller.status, 'connecting');
  assert.equal(h.controller.connected, false);
  assert.equal(user.videoTrack.plays.length, 1);
  assert.equal(user.videoTrack.stops, 0);
  gate.resolve();
  await connecting;
  assert.equal(h.controller.status, 'connected');
  assert.equal(h.controller.connected, true);
  assert.equal(h.clients[0].subscribes.length, 1);
  assert.equal(h.created.length, 0);
});