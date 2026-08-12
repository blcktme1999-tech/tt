const socket = io();

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
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '請稍後再試');
  return data;
}

function showNotice(text, type = 'info') {
  const notice = $('#citizenStatus');
  notice.textContent = text;
  notice.className = `notice ${type}`;
}

function activatePanel(panelId) {
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
  $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.panel === panelId));
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
  $('[data-action="startCamera"]', root).addEventListener('click', startCamera);
  $('[data-action="startRecord"]', root).addEventListener('click', startRecording);
  $('[data-action="stopRecord"]', root).addEventListener('click', () => stopRecording(caseItem.id));
  $('[data-action="joinCall"]', root).addEventListener('click', () => joinCall(caseItem.id));
  $('[data-action="leaveCall"]', root).addEventListener('click', () => leaveCall(caseItem.id));
  $('.upload-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append('video', event.currentTarget.video.files[0]);
    formData.append('kind', 'upload');
    await api(`/api/cases/${caseItem.id}/files`, { method: 'POST', body: formData });
    event.currentTarget.reset();
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
  state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const localVideo = $('#localVideo');
  if (localVideo) localVideo.srcObject = state.localStream;
  await localVideo.play().catch(() => {});
}

async function startRecording() {
  if (!state.localStream) await startCamera();
  state.chunks = [];
  state.recorder = new MediaRecorder(state.localStream, { mimeType: 'video/webm' });
  state.recorder.ondataavailable = (event) => event.data.size && state.chunks.push(event.data);
  state.recorder.start();
}

function stopRecording(caseId) {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  state.recorder.onstop = async () => {
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const formData = new FormData();
    formData.append('video', blob, `video-statement-${Date.now()}.webm`);
    formData.append('kind', 'recording');
    await api(`/api/cases/${caseId}/files`, { method: 'POST', body: formData });
  };
  state.recorder.stop();
}

async function joinCall(caseId) {
  if (!state.localStream) await startCamera();
  state.joinedCall = true;
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
  state.me = await api('/api/me');
  if (state.me.user) {
    $('#staffLogin').classList.add('hidden');
    $('#staffWorkspace').classList.remove('hidden');
    if (state.me.user.role === 'admin') $('#adminWorkspace').classList.remove('hidden');
    await loadCases();
  }
  if (state.me.case) renderCitizenWorkspace(state.me.case);
})();