const socket = window.io ? window.io() : createDemoSocket();
let usingDemoData = false;

const state = {
  me: null,
  currentCase: null,
  cases: [],
  recorder: null,
  chunks: [],
  localStream: null,
  peer: null,
  joinedCall: false,
  agoraClient: null,
  agoraTracks: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (error) {
    usingDemoData = true;
    return demoApi(path, options);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    usingDemoData = true;
    return demoApi(path, options);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '請稍後再試');
  return data;
}

function queryPath(path, params) {
  const search = new URLSearchParams(params);
  return `${path}?${search.toString()}`;
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
    async emit(event, payload) {
      if (event === 'message:create') {
        if (!usingDemoData) {
          try {
            const { message } = await api(`/api/cases/${payload.caseId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ body: payload.body })
            });
            dispatch('message:created', message);
            return;
          } catch (_error) {
          }
        }
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
      { id: 'admin', username: 'admin', password: 'admin', role: 'admin', displayName: '系統管理員', createdAt: new Date().toISOString() }
    ],
    cases: [
      { id: 'demo-case-1', citizenName: '測試民眾', agoraChannel: 'A123456789', status: 'pending', createdAt: new Date().toISOString(), approvedAt: null }
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
  const url = new URL(path, window.location.origin);
  const route = url.pathname;
  const body = options.body instanceof FormData ? options.body : JSON.parse(options.body || '{}');

  if (route === '/api/me' && url.searchParams.get('action') === 'staff-login') {
    const username = url.searchParams.get('username');
    const password = url.searchParams.get('password');
    const user = db.users.find((item) => item.username === username && item.password === password);
    if (!user) throw new Error('帳號或密碼錯誤');
    db.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName };
    setDemoDb(db);
    return { user: db.session.user };
  }

  if (route === '/api/me' && url.searchParams.get('action') === 'citizen-start') {
    const citizenName = url.searchParams.get('citizenName');
    const nationalId = url.searchParams.get('nationalId');
    let caseItem = db.cases.find((item) => item.citizenName === citizenName && item.agoraChannel === nationalId);
    if (!caseItem) {
      caseItem = { id: demoId(), citizenName, agoraChannel: nationalId, status: 'pending', interviewStatus: 'idle', createdAt: new Date().toISOString(), approvedAt: null };
      db.cases.push(caseItem);
      db.messages.push({ id: demoId(), caseId: caseItem.id, senderType: 'system', senderName: '系統', body: '民眾已送出線上客服開通申請，等待管理員審核。', createdAt: new Date().toISOString() });
    }
    db.session.case = caseItem.status === 'open' ? caseItem : null;
    setDemoDb(db);
    return { status: caseItem.status === 'open' ? 'open' : 'pending', case: caseItem };
  }

  if (route === '/api/me' && url.searchParams.get('action') === 'cases') return { cases: db.cases };

  if (route === '/api/me' && url.searchParams.get('action') === 'create-case') {
    const citizenName = url.searchParams.get('citizenName');
    const nationalId = url.searchParams.get('nationalId');
    let caseItem = db.cases.find((item) => item.citizenName === citizenName && item.agoraChannel === nationalId);
    if (!caseItem) {
      caseItem = { id: demoId(), citizenName, agoraChannel: nationalId, status: 'open', interviewStatus: 'idle', createdAt: new Date().toISOString(), approvedAt: new Date().toISOString() };
      db.cases.push(caseItem);
    } else {
      caseItem.status = 'open';
      caseItem.approvedAt = new Date().toISOString();
    }
    setDemoDb(db);
    return { case: caseItem };
  }

  if (route === '/api/me' && url.searchParams.get('action') === 'approve-case') {
    const caseItem = db.cases.find((item) => item.id === url.searchParams.get('caseId'));
    if (!caseItem) throw new Error('找不到案件');
    caseItem.status = 'open';
    caseItem.approvedAt = new Date().toISOString();
    setDemoDb(db);
    return { case: caseItem };
  }

  if (route === '/api/me' && url.searchParams.get('action') === 'statement') {
    const caseItem = db.cases.find((item) => item.id === url.searchParams.get('caseId'));
    if (!caseItem) throw new Error('找不到案件');
    caseItem.interviewStatus = url.searchParams.get('active') === '1' ? 'active' : 'idle';
    setDemoDb(db);
    return { case: caseItem };
  }

  if (route === '/api/me') return { user: db.session.user || null, case: db.session.case || null };

  if ((route === '/api/citizen/start' || route === '/api/citizen-start') && (method === 'POST' || method === 'GET')) {
    const citizenName = method === 'GET' ? url.searchParams.get('citizenName') : body.citizenName;
    const nationalId = method === 'GET' ? url.searchParams.get('nationalId') : body.nationalId;
    let caseItem = db.cases.find((item) => item.citizenName === citizenName && item.agoraChannel === nationalId);
    if (!caseItem) {
      caseItem = { id: demoId(), citizenName, agoraChannel: nationalId, status: 'pending', createdAt: new Date().toISOString(), approvedAt: null };
      db.cases.push(caseItem);
      db.messages.push({ id: demoId(), caseId: caseItem.id, senderType: 'system', senderName: '系統', body: '民眾已送出線上客服開通申請，等待管理員審核。', createdAt: new Date().toISOString() });
    }
    db.session.case = caseItem.status === 'open' ? caseItem : null;
    setDemoDb(db);
    return { status: caseItem.status === 'open' ? 'open' : 'pending', case: caseItem };
  }

  if ((route === '/api/staff/login' || route === '/api/staff-login') && (method === 'POST' || method === 'GET')) {
    const username = method === 'GET' ? url.searchParams.get('username') : body.username;
    const password = method === 'GET' ? url.searchParams.get('password') : body.password;
    const user = db.users.find((item) => item.username === username && item.password === password);
    if (!user) throw new Error('帳號或密碼錯誤');
    db.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName };
    setDemoDb(db);
    return { user: db.session.user };
  }

  if (route === '/api/cases' && method === 'POST') {
    let caseItem = db.cases.find((item) => item.citizenName === body.citizenName && item.agoraChannel === body.nationalId);
    if (!caseItem) {
      caseItem = { id: demoId(), citizenName: body.citizenName, agoraChannel: body.nationalId, status: 'open', interviewStatus: 'idle', createdAt: new Date().toISOString(), approvedAt: new Date().toISOString() };
      db.cases.push(caseItem);
    } else {
      caseItem.status = 'open';
      caseItem.approvedAt = new Date().toISOString();
    }
    setDemoDb(db);
    return { case: caseItem };
  }

  if (route === '/api/cases') return { cases: db.cases };

  const approveMatch = route.match(/^\/api\/cases\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const caseItem = db.cases.find((item) => item.id === approveMatch[1]);
    if (!caseItem) throw new Error('找不到案件');
    caseItem.status = 'open';
    caseItem.approvedAt = new Date().toISOString();
    db.messages.push({ id: demoId(), caseId: caseItem.id, senderType: 'system', senderName: '系統', body: '管理員已開通線上客服服務。', createdAt: new Date().toISOString() });
    setDemoDb(db);
    return { case: caseItem };
  }

  const statementMatch = route.match(/^\/api\/cases\/([^/]+)\/statement$/);
  if (statementMatch && method === 'POST') {
    const caseItem = db.cases.find((item) => item.id === statementMatch[1]);
    if (!caseItem) throw new Error('找不到案件');
    caseItem.interviewStatus = body.active ? 'active' : 'idle';
    setDemoDb(db);
    return { case: caseItem };
  }

  const messagesMatch = route.match(/^\/api\/cases\/([^/]+)\/messages$/);
  if (messagesMatch) return { messages: db.messages.filter((message) => message.caseId === messagesMatch[1]) };

  const filesMatch = route.match(/^\/api\/cases\/([^/]+)\/files$/);
  if (filesMatch && method === 'POST') {
    const file = body.get('video');
    const saved = { id: demoId(), uploadedBy: db.session.user?.displayName || '民眾', originalName: file?.name || 'demo-video.webm', storedName: '', mimeType: file?.type || 'video/webm', size: file?.size || 0, kind: body.get('kind') || 'upload', createdAt: new Date().toISOString(), url: file ? URL.createObjectURL(file) : '#' };
    db.files.push({ ...saved, caseId: filesMatch[1] });
    setDemoDb(db);
    socket.dispatch?.('file:created', saved);
    return { file: saved };
  }
  if (filesMatch) return { files: db.files.filter((file) => file.caseId === filesMatch[1]) };

  if (route === '/api/users') {
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

async function resetStaffSession() {
  try {
    await api('/api/staff/logout', { method: 'POST' });
  } catch (_error) {
  }
  localStorage.removeItem('cib-demo-db');
  window.location.href = '/admin#admin';
}

function renderAdminLoadError(error) {
  const root = $('#adminWorkspace');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="surface compact">
      <h2>後台資料載入失敗</h2>
      <p class="muted">${escapeHtml(error.message || '請重新登入後再試。')}</p>
      <button data-action="resetStaffSession" class="danger">重新登入</button>
    </div>
  `;
  $('[data-action="resetStaffSession"]', root).addEventListener('click', resetStaffSession);
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

function caseStatus(caseItem) {
  if (caseItem.interviewStatus === 'active') return '筆錄中';
  return caseItem.status === 'open' ? '已開通' : '待審核';
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
  list.innerHTML = cases.length ? '' : `<p class="muted">${isAdmin ? '目前沒有待審核案件。' : '目前沒有案件。'}</p>`;
  cases.forEach((caseItem) => {
    const button = document.createElement('button');
    button.className = `case-card ${state.currentCase?.id === caseItem.id ? 'active' : ''}`;
    button.innerHTML = `
      <strong>${caseItem.citizenName}</strong>
      <div class="meta">${caseStatus(caseItem)} · ${formatTime(caseItem.createdAt)}</div>
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
      <div class="summary-box">Agora 房間<strong>${escapeHtml(caseItem.agoraChannel || caseItem.id.slice(0, 8))}</strong></div>
      <div class="summary-box">狀態<strong class="status ${caseItem.interviewStatus === 'active' ? 'active' : caseItem.status}">${caseStatus(caseItem)}</strong></div>
      <div class="summary-box">建立時間<strong>${formatTime(caseItem.createdAt)}</strong></div>
    </div>
  `;
  const approveButton = $('[data-action="approve"]', summary);
  if (approveButton) {
    approveButton.addEventListener('click', async () => {
      await api(queryPath('/api/me', { action: 'approve-case', caseId: caseItem.id }));
      await loadCases();
    });
  }
  await renderConversation(conversation, caseItem);
  await renderMedia(media, caseItem, isAdmin);
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

async function renderMedia(root, caseItem, isAdmin) {
  const { files } = await api(`/api/cases/${caseItem.id}/files`);
  const callButtons = isAdmin
    ? '<button data-action="joinCall" class="warning">加入視訊筆錄</button><button data-action="leaveCall" class="danger">離開視訊</button>'
    : '<button data-action="joinCall" class="warning">製作筆錄</button><button data-action="startRecord" class="secondary">開始錄製</button><button data-action="stopRecord" class="secondary">停止並上傳</button><button data-action="leaveCall" class="danger">結束筆錄</button>';
  root.innerHTML = `
    <div class="section-heading"><h2>視訊筆錄與影片</h2></div>
    <div class="media-grid">
      <div class="media-controls">
        <div class="video-pair">
          <div id="localVideoSlot" class="video-slot"><video id="localVideo" muted playsinline></video></div>
          <div id="remoteVideoSlot" class="video-slot"><video id="remoteVideo" playsinline></video></div>
        </div>
        <div class="button-row">
          ${callButtons}
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
  const recordButton = $('[data-action="startRecord"]', root);
  if (recordButton) recordButton.addEventListener('click', () => startRecording().catch(reportActionError));
  const stopRecordButton = $('[data-action="stopRecord"]', root);
  if (stopRecordButton) stopRecordButton.addEventListener('click', () => stopRecording(caseItem.id));
  $('[data-action="joinCall"]', root).addEventListener('click', () => joinCall(caseItem.id, !isAdmin).catch(reportActionError));
  $('[data-action="leaveCall"]', root).addEventListener('click', () => leaveCall(caseItem.id, !isAdmin));
  $('.upload-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const file = event.currentTarget.video.files[0];
      await uploadVideo(caseItem.id, file, file.name, 'upload');
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
        if (usingDemoData) return createDemoVideoStream();
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
    uploadVideo(caseId, blob, `video-statement-${Date.now()}.webm`, 'recording').catch(reportActionError);
  };
  state.recorder.stop();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('讀取影片檔失敗'));
    reader.readAsDataURL(file);
  });
}

async function uploadVideo(caseId, file, fileName, kind) {
  const dataUrl = await readFileAsDataUrl(file);
  const { file: saved } = await api(`/api/cases/${caseId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      dataUrl,
      fileName,
      mimeType: file.type || 'video/webm',
      size: file.size || 0,
      kind
    })
  });
  const list = $('.panel.active .file-list');
  if (list && saved) appendFile(list, saved);
}

async function updateStatementStatus(caseId, active) {
  const { case: caseItem } = await api(queryPath('/api/me', { action: 'statement', caseId, active: active ? '1' : '0' }));
  state.currentCase = caseItem || state.currentCase;
}

async function joinCall(caseId, markStatement = false) {
  state.joinedCall = true;
  if (usingDemoData) {
    if (!state.localStream) await startCamera();
    const remoteVideo = $('#remoteVideo');
    if (remoteVideo) {
      remoteVideo.srcObject = state.localStream;
      await remoteVideo.play().catch(() => {});
    }
    if (markStatement) await updateStatementStatus(caseId, true);
    socket.emit('call:join', caseId);
    return;
  }

  if (!window.AgoraRTC) throw new Error('Agora SDK 尚未載入，請重新整理後再試。');
  await leaveCall(caseId);
  const session = await api(`/api/cases/${caseId}/agora-token`, { method: 'POST' });
  const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  state.agoraClient = client;

  client.on('user-published', async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === 'video') user.videoTrack.play('remoteVideoSlot');
    if (mediaType === 'audio') user.audioTrack.play();
  });
  client.on('user-unpublished', (_user, mediaType) => {
    if (mediaType === 'video') $('#remoteVideoSlot').innerHTML = '<video id="remoteVideo" playsinline></video>';
  });

  await client.join(session.appId, session.channelName, session.token, session.uid);
  const tracks = await createAgoraTracks();
  state.agoraTracks = tracks;
  $('#localVideoSlot').innerHTML = '';
  $('#remoteVideoSlot').innerHTML = '';
  tracks.find((track) => track.trackMediaType === 'video')?.play('localVideoSlot');
  await client.publish(tracks);
  state.joinedCall = true;
  if (markStatement) await updateStatementStatus(caseId, true);
  socket.emit('call:join', caseId);
}

async function createAgoraTracks() {
  try {
    const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
    return tracks;
  } catch (error) {
    if (error.code === 'DEVICE_NOT_FOUND' || error.name === 'NotFoundError') {
      const videoTrack = await AgoraRTC.createCameraVideoTrack();
      return [videoTrack];
    }
    throw error;
  }
}

async function leaveAgoraCall() {
  state.agoraTracks.forEach((track) => {
    track.stop();
    track.close();
  });
  state.agoraTracks = [];
  if (state.agoraClient) {
    await state.agoraClient.leave();
    state.agoraClient = null;
  }
  $('#localVideoSlot').innerHTML = '<video id="localVideo" muted playsinline></video>';
  $('#remoteVideoSlot').innerHTML = '<video id="remoteVideo" playsinline></video>';
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

async function leaveCall(caseId, markStatement = false) {
  if (state.agoraClient || state.agoraTracks.length) await leaveAgoraCall();
  state.peer?.close();
  state.peer = null;
  state.joinedCall = false;
  const remoteVideo = $('#remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;
  if (markStatement) updateStatementStatus(caseId, false).catch(reportActionError);
  socket.emit('call:leave', caseId);
}

async function loadCases() {
  const data = await api(queryPath('/api/me', { action: 'cases' }));
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
      <h2>預先開通民眾</h2>
      <form id="createCaseForm" class="stacked-form">
        <label>姓名<input name="citizenName" required></label>
        <label>身分證/居留證號<input name="nationalId" required></label>
        <button type="submit">新增並直接開通</button>
      </form>
    </div>
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
  $('#createCaseForm', tools).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(queryPath('/api/me', { action: 'create-case', citizenName: form.citizenName.value, nationalId: form.nationalId.value }));
    form.reset();
    await loadCases();
  });
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

$$('.tab-button').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.panel === 'adminPanel' && !state.me?.user) {
    activatePanel('staffPanel');
    if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') window.history.replaceState(null, '', '/admin#admin');
    return;
  }
  activatePanel(button.dataset.panel);
}));

$('#citizenForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api(queryPath('/api/me', { action: 'citizen-start', citizenName: form.citizenName.value, nationalId: form.nationalId.value }));
    if (data.status === 'pending') {
      $('#citizenWorkspace').classList.add('hidden');
      showNotice('已送出開通申請，請等待管理員審核。審核完成後用同一組資料即可進入客服。');
      return;
    }
    showNotice('已進入線上客服服務。');
    state.me = await api('/api/me');
    renderCitizenWorkspace(data.case);
  } catch (error) {
    $('#citizenWorkspace').classList.add('hidden');
    showNotice(error.message || '申請失敗，請稍後再試。', 'error');
  }
});

$('#staffLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api(queryPath('/api/me', { action: 'staff-login', username: form.username.value, password: form.password.value }));
    state.me = await api('/api/me');
    $('#staffLogin').classList.add('hidden');
    $('#staffWorkspace').classList.remove('hidden');
    if (state.me.user.role === 'admin') {
      $('#adminWorkspace').classList.remove('hidden');
      activatePanel('adminPanel');
    }
    await loadCases().catch(renderAdminLoadError);
  } catch (error) {
    window.alert(error.message || '登入失敗，請確認帳號密碼。');
  }
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
  const entryMode = document.body.dataset.entry || 'mixed';
  const isAdminPage = window.location.pathname === '/admin' || window.location.pathname === '/admin/';
  if (entryMode === 'citizen') {
    activatePanel('citizenPanel');
    window.history.replaceState(null, '', window.location.pathname);
    state.me = await api('/api/me').catch(() => ({ user: null, case: null }));
    if (state.me.case) renderCitizenWorkspace(state.me.case);
    return;
  }
  if (isAdminPage) {
    window.history.replaceState(null, '', '/admin#admin');
  }
  const initialPanel = {
    '#citizen': 'citizenPanel',
    '#staff': 'staffPanel',
    '#admin': 'adminPanel'
  }[window.location.hash];
  if (initialPanel) activatePanel(initialPanel);
  if (isAdminPage || window.location.hash === '#admin' || window.location.hash === '#staff') {
    activatePanel('staffPanel');
    if (isAdminPage) window.history.replaceState(null, '', '/admin#admin');
  }
  state.me = await api('/api/me').catch(() => ({ user: null, case: null }));
  if (state.me.user) {
    $('#staffLogin').classList.add('hidden');
    $('#staffWorkspace').classList.remove('hidden');
    if (state.me.user.role === 'admin') {
      $('#adminWorkspace').classList.remove('hidden');
      activatePanel('adminPanel');
    }
    await loadCases().catch(renderAdminLoadError);
  } else if (window.location.hash === '#admin' || window.location.hash === '#staff') {
    activatePanel('staffPanel');
    if (isAdminPage) window.history.replaceState(null, '', '/admin#admin');
  }
  if (state.me.case) renderCitizenWorkspace(state.me.case);
})();