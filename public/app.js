const socket = window.io ? window.io() : createDemoSocket();
const demoMode = !window.io;

const state = {
  me: null,
  currentCase: null,
  cases: [],
  recorder: null,
  chunks: [],
  localStream: null,
  peer: null,
  joinedCall: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...options
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('靜態測試模式');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '請稍後再試');
    return data;
  } catch (error) {
    if (demoMode) return demoApi(path, options);
    throw error;
  }
}

function createDemoSocket() {
  const handlers = {};
  const dispatch = (event, payload) => {
    (handlers[event] || []).forEach((callback) => callback(payload));
  };
  return {
    on(event, callback) {
      handlers[event] = handlers[event] || [];
      handlers[event].push(callback);
    },
    dispatch,
    emit(event, payload) {
      if (event === 'message:create') {
        const db = getDemoDb();
        const caseItem = db.cases.find((item) => item.id === payload.caseId);
        if (!caseItem || !String(payload.body || '').trim()) return;
        const sender = db.session.user || { role: 'citizen', displayName: caseItem.citizenName };
        const message = {
          id: demoId(),
          caseId: caseItem.id,
          senderType: sender.role === 'admin' ? 'admin' : sender.role === 'agent' ? 'agent' : 'citizen',
          senderName: sender.displayName || caseItem.citizenName,
          body: String(payload.body).trim(),
          createdAt: new Date().toISOString()
        };
        db.messages.push(message);
        setDemoDb(db);
        dispatch('message:created', message);
      }
      if (event === 'call:join') dispatch('call:peer-ready');
      if (event === 'call:leave') dispatch('call:peer-left');
    }
  };
}

function demoId() {
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDemoDb() {
  const saved = localStorage.getItem('cib-demo-db');
  if (saved) return JSON.parse(saved);
  const db = {
    session: {},
    users: [
      { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', displayName: '系統管理員', createdAt: new Date().toISOString() }
    ],
    cases: [
      { id: 'demo-case-1', citizenName: '測試民眾', status: 'pending', createdAt: new Date().toISOString(), approvedAt: null }
    ],
    messages: [
      { id: 'demo-message-1', caseId: 'demo-case-1', senderType: 'system', senderName: '系統', body: '這是 Vercel 靜態測試模式，可測登入、開帳號與審核流程。', createdAt: new Date().toISOString() }
    ],
    files: []
  };
  setDemoDb(db);
  return db;
}

function setDemoDb(db) {
  localStorage.setItem('cib-demo-db', JSON.stringify(db));
}

async function demoApi(path, options = {}) {
  const db = getDemoDb();
  const method = options.method || 'GET';
  const body = options.body instanceof FormData ? options.body : JSON.parse(options.body || '{}');

  if (path === '/api/me') return { user: db.session.user || null, case: db.session.case || null };

  if (path === '/api/citizen/start' && method === 'POST') {
    let caseItem = db.cases.find((item) => item.citizenName === body.citizenName);
    if (!caseItem) {
      caseItem = { id: demoId(), citizenName: body.citizenName, status: 'pending', createdAt: new Date().toISOString(), approvedAt: null };
      db.cases.push(caseItem);
      db.messages.push({ id: demoId(), caseId: caseItem.id, senderType: 'system', senderName: '系統', body: '民眾已送出線上客服開通申請，等待管理員審核。', createdAt: new Date().toISOString() });
    }
    db.session.case = caseItem.status === 'open' ? caseItem : null;
    setDemoDb(db);
    return { status: caseItem.status === 'open' ? 'open' : 'pending', case: caseItem };
  }

  if (path === '/api/staff/login' && method === 'POST') {
    const user = db.users.find((item) => item.username === body.username && item.password === body.password);
    if (!user) throw new Error('帳號或密碼錯誤');
    db.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName };
    setDemoDb(db);
    return { user: db.session.user };
  }

  if (path === '/api/cases') return { cases: db.cases };

  const approveMatch = path.match(/^\/api\/cases\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const caseItem = db.cases.find((item) => item.id === approveMatch[1]);
    if (!caseItem) throw new Error('找不到案件');
    caseItem.status = 'open';
    caseItem.approvedAt = new Date().toISOString();
    db.messages.push({ id: demoId(), caseId: caseItem.id, senderType: 'system', senderName: '系統', body: '管理員已開通線上客服服務。', createdAt: new Date().toISOString() });
    setDemoDb(db);
    return { case: caseItem };
  }

  const messagesMatch = path.match(/^\/api\/cases\/([^/]+)\/messages$/);
  if (messagesMatch) return { messages: db.messages.filter((message) => message.caseId === messagesMatch[1]) };

  const filesMatch = path.match(/^\/api\/cases\/([^/]+)\/files$/);
  if (filesMatch && method === 'POST') {
    const file = body.get('video');
    const saved = { id: demoId(), uploadedBy: db.session.user?.displayName || '民眾', originalName: file?.name || 'demo-video.webm', storedName: '', mimeType: file?.type || 'video/webm', size: file?.size || 0, kind: body.get('kind') || 'upload', createdAt: new Date().toISOString(), url: file ? URL.createObjectURL(file) : '#' };
    db.files.push({ ...saved, caseId: filesMatch[1] });
    setDemoDb(db);
    socket.dispatch?.('file:created', saved);
    return { file: saved };
  }
  if (filesMatch) return { files: db.files.filter((file) => file.caseId === filesMatch[1]) };

  if (path === '/api/users') {
    if (method === 'POST') {
      if (db.users.some((user) => user.username === body.username)) throw new Error('帳號已存在');
      db.users.push({ id: demoId(), username: body.username, password: body.password, role: body.role, displayName: body.displayName, createdAt: new Date().toISOString() });
      setDemoDb(db);
      return { ok: true };
    }
    return { users: db.users.map(({ password, ...user }) => user) };
  }

  return { ok: true };
}

function showNotice(text, type = 'info') {
  const notice = $('#citizenStatus');
  notice.textContent = text;
  notice.className = `notice ${type}`;
}

function reportActionError(error) {
  window.alert(error.message || '操作失敗，請稍後再試。');
}

function activatePanel(panelId) {
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
  $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.panel === panelId));
  const hashMap = { citizenPanel: 'citizen', staffPanel: 'staff', adminPanel: 'admin' };
  if (hashMap[panelId]) window.history.replaceState(null, '', `#${hashMap[panelId]}`);
}

function formatTime(value) {
  return new Date(value).toLocaleString('zh-TW', { hour12: false });
}

function caseStatus(status) {
  return status === 'open' ? '已開通' : '待審核';
}

function renderCitizenWorkspace(caseItem) {
  state.currentCase = caseItem;
  const root = $('#citizenWorkspace');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="case-detail">
      <div data-slot="caseSummary" class="surface"></div>
      <div data-slot="conversation" class="surface"></div>
      <div data-slot="media" class="surface"></div>
    </div>
  `;
  renderCaseDetail(root, caseItem, false);
}

function renderCaseShell(root, cases, isAdmin) {
  const template = $('#caseWorkspaceTemplate').content.cloneNode(true);
  root.innerHTML = '';
  root.appendChild(template);
  $('[data-action="refreshCases"]', root).addEventListener('click', loadCases);
  renderCaseList(root, cases, isAdmin);
}

function renderCaseList(root, cases, isAdmin) {
  const list = $('[data-slot="caseList"]', root);
  list.innerHTML = cases.length ? '' : '<p class="muted">目前沒有案件。</p>';
  cases.forEach((caseItem) => {
    const button = document.createElement('button');
    button.className = `case-card ${state.currentCase?.id === caseItem.id ? 'active' : ''}`;
    button.innerHTML = `
      <strong>${caseItem.citizenName}</strong>
      <div class="meta">${caseStatus(caseItem.status)} · ${formatTime(caseItem.createdAt)}</div>
    `;
    button.addEventListener('click', () => {
      state.currentCase = caseItem;
      renderCaseList(root, state.cases, isAdmin);
      renderCaseDetail(root, caseItem, isAdmin);
    });
    list.appendChild(button);
  });
}

async function renderCaseDetail(root, caseItem, isAdmin) {
  socket.emit('case:join', caseItem.id);
  const summary = $('[data-slot="caseSummary"]', root);
  const conversation = $('[data-slot="conversation"]', root);
  const media = $('[data-slot="media"]', root);
  summary.classList.remove('hidden');
  conversation.classList.remove('hidden');
  media.classList.remove('hidden');
  summary.innerHTML = `
    <div class="section-heading">
      <h2>${caseItem.citizenName}</h2>
      ${isAdmin && caseItem.status === 'pending' ? '<button data-action="approve" class="warning">審核開通</button>' : ''}
    </div>
    <div class="summary-grid">
      <div class="summary-box">案件編號<strong>${caseItem.id.slice(0, 8)}</strong></div>
      <div class="summary-box">狀態<strong class="status ${caseItem.status}">${caseStatus(caseItem.status)}</strong></div>
      <div class="summary-box">建立時間<strong>${formatTime(caseItem.createdAt)}</strong></div>
    </div>
  `;
  const approveButton = $('[data-action="approve"]', summary);
  if (approveButton) {
    approveButton.addEventListener('click', async () => {
      await api(`/api/cases/${caseItem.id}/approve`, { method: 'POST' });
      await loadCases();
    });
  }
  await renderConversation(conversation, caseItem);
  await renderMedia(media, caseItem);
}

async function renderConversation(root, caseItem) {
  const { messages } = await api(`/api/cases/${caseItem.id}/messages`);
  root.innerHTML = `
    <div class="section-heading"><h2>客服訊息紀錄</h2></div>
    <div class="chat-log"></div>
    <form class="message-form">
      <textarea name="body" placeholder="輸入訊息" required></textarea>
      <button type="submit">送出</button>
    </form>
  `;
  const log = $('.chat-log', root);
  messages.forEach((message) => appendMessage(log, message));
  $('.message-form', root).addEventListener('submit', (event) => {
    event.preventDefault();
    const body = event.currentTarget.body.value.trim();
    if (!body) return;
    socket.emit('message:create', { caseId: caseItem.id, body });
    event.currentTarget.reset();
  });
}

function appendMessage(log, message) {
  const mine = state.me?.user
    ? ['agent', 'admin'].includes(message.senderType)
    : message.senderType === 'citizen';
  const item = document.createElement('div');
  item.className = `message ${mine ? 'mine' : ''} ${message.senderType === 'system' ? 'system' : ''}`;
  item.innerHTML = `<small>${message.senderName} · ${formatTime(message.createdAt)}</small><div>${escapeHtml(message.body)}</div>`;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

async function renderMedia(root, caseItem) {
  const { files } = await api(`/api/cases/${caseItem.id}/files`);
  root.innerHTML = `
    <div class="section-heading"><h2>視訊筆錄與影片</h2></div>
    <div class="media-grid">
      <div class="media-controls">
        <div class="video-pair">
          <video id="localVideo" muted playsinline></video>
          <video id="remoteVideo" playsinline></video>
        </div>
        <div class="button-row">
          <button data-action="startCamera">開啟鏡頭</button>
          <button data-action="startRecord" class="secondary">開始錄製</button>
          <button data-action="stopRecord" class="secondary">停止並上傳</button>
          <button data-action="joinCall" class="warning">加入視訊筆錄</button>
          <button data-action="leaveCall" class="danger">離開視訊</button>
        </div>
        <form class="upload-form stacked-form">
          <label>上傳影片檔<input name="video" type="file" accept="video/*" required></label>
          <button type="submit">上傳影片給客服端</button>
        </form>
      </div>
      <div>
        <h3>影片紀錄</h3>
        <div class="file-list"></div>
      </div>
    </div>
  `;
  files.forEach((file) => appendFile($('.file-list', root), file));
  $('[data-action="startCamera"]', root).addEventListener('click', () => startCamera().catch(reportActionError));
  $('[data-action="startRecord"]', root).addEventListener('click', () => startRecording().catch(reportActionError));
  $('[data-action="stopRecord"]', root).addEventListener('click', () => stopRecording(caseItem.id));
  $('[data-action="joinCall"]', root).addEventListener('click', () => joinCall(caseItem.id).catch(reportActionError));
  $('[data-action="leaveCall"]', root).addEventListener('click', () => leaveCall(caseItem.id));
  $('.upload-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData();
      formData.append('video', event.currentTarget.video.files[0]);
      formData.append('kind', 'upload');
      await api(`/api/cases/${caseItem.id}/files`, { method: 'POST', body: formData });
      event.currentTarget.reset();
    } catch (error) {
      reportActionError(error);
    }
  });
}

function appendFile(list, file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = `
    <a href="${file.url}" target="_blank" rel="noreferrer">${escapeHtml(file.originalName)}</a>
    <div class="muted">${file.kind === 'recording' ? '錄製影片' : '上傳影片'} · ${escapeHtml(file.uploadedBy)} · ${formatTime(file.createdAt)}</div>
  `;
  list.prepend(item);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此瀏覽器或網址不支援鏡頭 API，請使用 HTTPS 或 localhost 測試。');
  state.localStream = await getCameraStream();
  const localVideo = $('#localVideo');
  if (localVideo) localVideo.srcObject = state.localStream;
  await localVideo.play().catch(() => {});
}

async function getCameraStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (error) {
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (videoOnlyError) {
        if (demoMode) return createDemoVideoStream();
        throw new Error('找不到可用的攝影機。請確認裝置已接上，或改用上傳影片檔。');
      }
    }
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') throw new Error('瀏覽器未允許使用攝影機或麥克風，請到網址列左側權限設定開啟。');
    if (error.name === 'NotReadableError') throw new Error('攝影機目前被其他程式占用，請關閉其他視訊軟體後再試。');
    throw error;
  }
}

function createDemoVideoStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext('2d');
  let frame = 0;
  const draw = () => {
    frame += 1;
    const hue = (frame * 2) % 360;
    context.fillStyle = `hsl(${hue} 55% 28%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.font = '42px sans-serif';
    context.fillText('視訊筆錄測試畫面', 280, 250);
    context.font = '24px sans-serif';
    context.fillText(new Date().toLocaleString('zh-TW'), 350, 300);
    requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(24);
}

async function startRecording() {
  if (!state.localStream) await startCamera();
  if (!window.MediaRecorder) throw new Error('此瀏覽器不支援 MediaRecorder 錄影 API。');
  state.chunks = [];
  const options = MediaRecorder.isTypeSupported('video/webm') ? { mimeType: 'video/webm' } : undefined;
  state.recorder = new MediaRecorder(state.localStream, options);
  state.recorder.ondataavailable = (event) => event.data.size && state.chunks.push(event.data);
  state.recorder.start();
}

function stopRecording(caseId) {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  state.recorder.onstop = async () => {
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType || 'video/webm' });
    const formData = new FormData();
    formData.append('video', blob, `video-statement-${Date.now()}.webm`);
    formData.append('kind', 'recording');
    await api(`/api/cases/${caseId}/files`, { method: 'POST', body: formData }).catch(reportActionError);
  };
  state.recorder.stop();
}

async function joinCall(caseId) {
  if (!state.localStream) await startCamera();
  state.joinedCall = true;
  if (demoMode) {
    const remoteVideo = $('#remoteVideo');
    if (remoteVideo) {
      remoteVideo.srcObject = state.localStream;
      await remoteVideo.play().catch(() => {});
    }
    socket.emit('call:join', caseId);
    return;
  }
  state.peer = createPeer(caseId);
  state.localStream.getTracks().forEach((track) => state.peer.addTrack(track, state.localStream));
  socket.emit('call:join', caseId);
}

function createPeer(caseId) {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.ontrack = (event) => {
    const remoteVideo = $('#remoteVideo');
    if (remoteVideo) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(() => {});
    }
  };
  peer.onicecandidate = (event) => {
    if (event.candidate) socket.emit('call:signal', { caseId, signal: { candidate: event.candidate } });
  };
  return peer;
}

function leaveCall(caseId) {
  state.peer?.close();
  state.peer = null;
  state.joinedCall = false;
  const remoteVideo = $('#remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;
  socket.emit('call:leave', caseId);
}

async function loadCases() {
  const data = await api('/api/cases');
  state.cases = data.cases;
  renderCaseShell($('#staffWorkspace'), state.cases.filter((item) => item.status === 'open'), false);
  if (state.me?.user?.role === 'admin') {
    renderCaseShell($('#adminWorkspace'), state.cases, true);
    await renderAdminTools();
  }
}

async function renderAdminTools() {
  const root = $('#adminWorkspace');
  const tools = document.createElement('div');
  tools.className = 'admin-grid';
  tools.innerHTML = `
    <div class="surface">
      <h2>新增客服/管理員</h2>
      <form id="createUserForm" class="stacked-form">
        <label>顯示姓名<input name="displayName" required></label>
        <label>帳號<input name="username" required></label>
        <label>密碼<input name="password" type="password" required></label>
        <label>角色<select name="role"><option value="agent">客服</option><option value="admin">管理員</option></select></label>
        <button type="submit">建立帳號</button>
      </form>
    </div>
    <div class="surface">
      <h2>帳號列表</h2>
      <div id="userList" class="table-list"></div>
    </div>
  `;
  root.appendChild(tools);
  $('#createUserForm', tools).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        displayName: form.displayName.value,
        username: form.username.value,
        password: form.password.value,
        role: form.role.value
      })
    });
    form.reset();
    await renderUserList();
  });
  await renderUserList();
}

async function renderUserList() {
  const list = $('#userList');
  if (!list) return;
  const { users } = await api('/api/users');
  list.innerHTML = '';
  users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `<strong>${escapeHtml(user.displayName)}</strong><div class="muted">${escapeHtml(user.username)} · ${user.role}</div>`;
    list.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

$$('.tab-button').forEach((button) => button.addEventListener('click', () => activatePanel(button.dataset.panel)));

$('#citizenForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = await api('/api/citizen/start', {
    method: 'POST',
    body: JSON.stringify({ citizenName: form.citizenName.value, nationalId: form.nationalId.value })
  });
  if (data.status === 'pending') {
    $('#citizenWorkspace').classList.add('hidden');
    showNotice('已送出開通申請，請等待管理員審核。審核完成後用同一組資料即可進入客服。');
    return;
  }
  showNotice('已進入線上客服服務。');
  state.me = await api('/api/me');
  renderCitizenWorkspace(data.case);
});

$('#staffLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await api('/api/staff/login', {
    method: 'POST',
    body: JSON.stringify({ username: form.username.value, password: form.password.value })
  });
  state.me = await api('/api/me');
  $('#staffLogin').classList.add('hidden');
  $('#staffWorkspace').classList.remove('hidden');
  if (state.me.user.role === 'admin') $('#adminWorkspace').classList.remove('hidden');
  await loadCases();
});

socket.on('message:created', (message) => {
  if (message.caseId !== state.currentCase?.id) return;
  const log = $('.panel.active .chat-log');
  if (log) appendMessage(log, message);
});

socket.on('file:created', (file) => {
  const list = $('.panel.active .file-list');
  if (list) appendFile(list, file);
});

socket.on('case:updated', async () => {
  if (state.me?.user) await loadCases();
});

socket.on('call:peer-ready', async () => {
  if (!state.joinedCall || !state.peer) return;
  const offer = await state.peer.createOffer();
  await state.peer.setLocalDescription(offer);
  socket.emit('call:signal', { caseId: state.currentCase.id, signal: { description: state.peer.localDescription } });
});

socket.on('call:signal', async (signal) => {
  if (!state.peer || !state.currentCase) return;
  if (signal.description) {
    await state.peer.setRemoteDescription(signal.description);
    if (signal.description.type === 'offer') {
      const answer = await state.peer.createAnswer();
      await state.peer.setLocalDescription(answer);
      socket.emit('call:signal', { caseId: state.currentCase.id, signal: { description: state.peer.localDescription } });
    }
  }
  if (signal.candidate) await state.peer.addIceCandidate(signal.candidate);
});

socket.on('call:peer-left', () => {
  state.peer?.close();
  state.peer = null;
});

(async function boot() {
  if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') {
    window.history.replaceState(null, '', '/admin#admin');
  }
  const initialPanel = {
    '#citizen': 'citizenPanel',
    '#staff': 'staffPanel',
    '#admin': 'adminPanel'
  }[window.location.hash];
  if (initialPanel) activatePanel(initialPanel);
  state.me = await api('/api/me');
  if (state.me.user) {
    $('#staffLogin').classList.add('hidden');
    $('#staffWorkspace').classList.remove('hidden');
    if (state.me.user.role === 'admin') $('#adminWorkspace').classList.remove('hidden');
    await loadCases();
  }
  if (state.me.case) renderCitizenWorkspace(state.me.case);
})();