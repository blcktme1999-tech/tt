'use strict';

// REST is the source of truth, including on hosts without Socket.IO. Never fake
// an authenticated session, message, upload or call when the server is offline.
const state = {
  me: null, currentCase: null, cases: [], detailRoot: null, callRoot: null,
  videoSession: null, mediaError: '', mediaPending: false,
  conversation: null, viewVersion: 0, caseRevision: 0,
  workflow: Promise.resolve(), caseLoad: null,
  casePollTimer: null, messagePollTimer: null
};
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
// Controller failures also reject public operations. Do not cache those rejects
// as workflow errors: lastError remains the controller's source of truth.
const controllerErrors = new WeakSet();
const IDENTITY_NOTICE = '此瀏覽器目前使用後台身分。請使用另一個瀏覽器設定檔或另一個瀏覽器進行民眾報案，避免共用登入身分。';
const $ = (selector, root = document) => root?.querySelector(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll(selector) || [])];
const casePath = (caseId, suffix = '') => `/api/cases/${encodeURIComponent(caseId)}${suffix}`;
const postOptions = (body) => ({ method: 'POST', body: JSON.stringify(body) });

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
  } catch (_) {
    throw new Error('無法連線至伺服器，操作尚未確認完成。請檢查網路後重試。');
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    throw new Error('伺服器未回傳有效 JSON，操作尚未確認完成。請稍後重試。');
  }
  let data;
  try { data = await response.json(); } catch (_) { throw new Error('伺服器回應格式錯誤，請稍後重試。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('伺服器回應格式錯誤。');
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '操作失敗，請稍後再試。');
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '時間未提供' : date.toLocaleString('zh-TW', { hour12: false });
}

function displayMessage(value) {
  const replacements = {
    '客服訊息紀錄': '案件訊息紀錄',
    '民眾已送出線上客服開通申請，等待管理員審核。': '民眾已送出線上報案開通申請，等待審核。',
    '管理員已開通線上客服服務。': '已開通線上報案系統。',
    '管理員已開通線上客服系統。': '已開通線上報案系統。',
    '管理員已預先開通線上客服服務。': '已預先開通線上報案系統。',
    'Agora 房間': '身分證字號', '進入線上客服': '我要視訊報案'
  };
  return replacements[value] || String(value ?? '');
}

function errorText(error) {
  return error?.message || '操作失敗，請稍後再試。';
}

function inlineNotice(root, text, slot = 'actionError') {
  if (!root) return;
  let notice = $(`[data-slot="${slot}"]`, root);
  if (!notice) {
    notice = document.createElement('div');
    notice.dataset.slot = slot;
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    root.appendChild(notice);
  }
  notice.className = 'notice error';
  notice.textContent = text;
  notice.hidden = !text;
}

function showNotice(text, type = 'info') {
  const notice = $('#citizenStatus');
  if (!notice) return;
  notice.textContent = text;
  notice.className = `notice ${type}`;
}

function reportActionError(error, root = state.detailRoot || $('#staffLogin')) {
  if (error?.name !== 'AbortError') inlineNotice(root, errorText(error));
}

// Selection, device operations, status changes and session changes share one
// queue. In-flight token/capture operations finish before their root is replaced.
function enqueueWorkflow(operation) {
  const result = state.workflow.then(operation);
  state.workflow = result.catch(() => {});
  return result;
}

function activatePanel(panelId) {
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
  $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.panel === panelId));
  const hash = { citizenPanel: 'citizen', staffPanel: 'staff', adminPanel: 'admin' }[panelId];
  if (hash) window.history.replaceState(null, '', `#${hash}`);
  if (panelId === 'citizenPanel' && state.me?.user) showNotice(IDENTITY_NOTICE, 'error');
}

function caseStatus(caseItem) {
  if (caseItem.status === 'closed') return '已結案';
  if (caseItem.status !== 'open') return '待審核';
  return caseItem.interviewStatus === 'active' ? '筆錄中' : '已開通';
}

function statusClass(caseItem) {
  return caseItem.status === 'open' && caseItem.interviewStatus === 'active' ? 'active' :
    ['pending', 'open', 'closed'].includes(caseItem.status) ? caseItem.status : 'pending';
}

function filterCaseItems(cases, isAdmin, search = '', filter = 'all') {
  const term = search.trim().toLocaleLowerCase();
  return cases.filter((item) => (isAdmin || item.status === 'open') &&
    (!term || [item.citizenName, item.id, item.nationalId, item.agoraChannel]
      .some((value) => String(value || '').toLocaleLowerCase().includes(term))) &&
    (filter === 'all' || (filter === 'active' ? item.status === 'open' && item.interviewStatus === 'active' : item.status === filter)));
}

function renderCaseShell(root, cases, isAdmin) {
  if (!root) return;
  if (!$('[data-slot="caseList"]', root)) {
    const template = $('#caseWorkspaceTemplate');
    if (!template) throw new Error('案件範本尚未載入。');
    root.appendChild(template.content.cloneNode(true));
    $('[data-action="refreshCases"]', root)?.addEventListener('click', () => loadCases().catch((error) => reportActionError(error, root)));
    $('[data-action="searchCases"]', root)?.addEventListener('input', () => renderCaseList(root, state.cases, isAdmin));
    $('[data-action="filterCases"]', root)?.addEventListener('change', () => renderCaseList(root, state.cases, isAdmin));
  }
  renderCaseList(root, cases, isAdmin);
}

function renderCaseList(root, cases, isAdmin) {
  const list = $('[data-slot="caseList"]', root);
  if (!list) return;
  const visible = filterCaseItems(cases, isAdmin, $('[data-action="searchCases"]', root)?.value,
    $('[data-action="filterCases"]', root)?.value || 'all');
  const count = $('[data-slot="caseCount"]', root);
  if (count) count.textContent = String(visible.length);
  const scrollTop = list.scrollTop;
  list.innerHTML = visible.length ? '' : '<p class="muted">目前沒有符合條件的案件。</p>';
  visible.forEach((caseItem) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `case-card ${state.currentCase?.id === caseItem.id ? 'active' : ''}`;
    button.setAttribute('aria-pressed', String(state.currentCase?.id === caseItem.id));
    button.innerHTML = `<strong>${escapeHtml(caseItem.citizenName)}</strong>
      <div class="meta"><span class="status ${statusClass(caseItem)}">${caseStatus(caseItem)}</span> · ${escapeHtml(formatTime(caseItem.createdAt))}</div>
      <div class="meta">${escapeHtml(caseItem.id)}</div>`;
    button.addEventListener('click', () => selectCase(root, caseItem, isAdmin).catch((error) => reportActionError(error, root)));
    list.appendChild(button);
  });
  list.scrollTop = scrollTop;
}

function renderAllCaseLists() {
  renderCaseList($('#staffWorkspace'), state.cases, false);
  if (state.me?.user?.role === 'admin') renderCaseList($('#adminWorkspace'), state.cases, true);
}

function isCurrentRoot(caseId, root = state.callRoot) {
  return Boolean(root?.isConnected && root === state.callRoot && root.dataset.caseId === String(caseId) && state.currentCase?.id === caseId);
}

function requireOpenRoot(caseId, root) {
  if (!isCurrentRoot(caseId, root)) throw new Error('案件已切換，請在目前案件重新操作。');
  if (state.currentCase.status !== 'open') throw new Error('案件尚未開通或已結案，無法使用視訊。');
}

function selectCase(root, caseItem, isAdmin = false) {
  return enqueueWorkflow(() => selectCaseNow(root, state.cases.find((item) => item.id === caseItem.id) || caseItem, isAdmin));
}

async function selectCaseNow(root, caseItem, isAdmin = false) {
  if (!root?.isConnected) return false;
  if (state.me?.user && root.id === 'citizenWorkspace') { showNotice(IDENTITY_NOTICE, 'error'); return false; }
  if (state.currentCase?.id === caseItem.id && state.detailRoot === root) {
    await applySelectedCase(caseItem);
    return true;
  }
  if (state.videoSession?.hasLocalMedia && !window.confirm('切換案件將關閉我方攝影機與麥克風，並中斷目前視訊。新案件只接收對方視訊，不會自動開啟我方裝置。是否繼續？')) return false;
  await disconnectCurrent();
  const previousRoot = state.detailRoot;
  state.viewVersion += 1;
  state.conversation = null;
  clearInterval(state.messagePollTimer);
  if (previousRoot && previousRoot !== root) {
    for (const slot of ['caseSummary', 'conversation', 'media']) {
      const node = $(`[data-slot="${slot}"]`, previousRoot);
      if (node) { node.replaceChildren(); node.classList.add('hidden'); }
    }
  }
  state.currentCase = caseItem;
  state.detailRoot = root;
  state.mediaError = '';
  root.classList.remove('hidden');
  if (root.id === 'citizenWorkspace' && !$('[data-slot="caseSummary"]', root)) {
    root.innerHTML = '<div class="case-detail"><div data-slot="caseSummary" class="surface"></div><div data-slot="media" class="surface"></div><div data-slot="conversation" class="surface"></div></div>';
  }
  renderCaseDetail(root, caseItem, isAdmin);
  renderAllCaseLists();
  if (state.me?.user && caseItem.status === 'open') {
    try { await watchCall(caseItem.id, state.callRoot); } catch (error) { showMediaError(error); }
  }
  return true;
}

async function renderCitizenWorkspace(caseItem) {
  return selectCase($('#citizenWorkspace'), caseItem, false);
}

function openCaseDetail(root, _cases, caseItem, isAdmin) {
  return selectCase(root, caseItem, isAdmin);
}

function renderCaseDetail(root, caseItem, isAdmin) {
  const summary = $('[data-slot="caseSummary"]', root);
  const conversation = $('[data-slot="conversation"]', root);
  const media = $('[data-slot="media"]', root);
  if (!summary || !conversation || !media) throw new Error('案件工作區尚未準備完成。');
  for (const node of [summary, conversation, media]) { node.classList.remove('hidden', 'empty-state'); node.dataset.caseId = String(caseItem.id); }
  summary.innerHTML = `<div class="section-heading"><h2>${escapeHtml(caseItem.citizenName)}</h2>
    ${isAdmin ? '<button type="button" data-action="approve" class="warning">審核開通</button>' : ''}</div>
    <div class="summary-grid">
      <div class="summary-box">案件編號<strong>${escapeHtml(caseItem.id)}</strong></div>
      <div class="summary-box">身分證字號<strong>${escapeHtml(caseItem.nationalId || caseItem.agoraChannel || '未提供')}</strong></div>
      <div class="summary-box">狀態<strong data-slot="caseStatus"></strong></div>
      <div class="summary-box">建立時間<strong>${escapeHtml(formatTime(caseItem.createdAt))}</strong></div>
    </div>`;
  $('[data-action="approve"]', summary)?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    enqueueWorkflow(async () => {
      if (state.detailRoot !== root || state.currentCase?.id !== caseItem.id) return;
      const data = await api(casePath(caseItem.id, '/approve'), { method: 'POST' });
      if (!data.case || data.case.id !== caseItem.id) throw new Error('審核結果不完整，請重新整理確認。');
      state.caseRevision += 1;
      state.cases = state.cases.map((item) => item.id === caseItem.id ? data.case : item);
      await applySelectedCase(data.case);
      renderAllCaseLists();
      await refreshMessages(caseItem.id);
    }).catch((error) => reportActionError(error, summary)).finally(() => { button.disabled = false; });
  });
  renderConversation(conversation, caseItem);
  renderMedia(media, caseItem);
  updateSummary(caseItem);
}

function updateSummary(caseItem) {
  const badge = $('[data-slot="caseStatus"]', state.detailRoot);
  if (badge) { badge.textContent = caseStatus(caseItem); badge.className = `status ${statusClass(caseItem)}`; }
  const approve = $('[data-action="approve"]', state.detailRoot);
  if (approve) approve.hidden = caseItem.status !== 'pending';
}

async function applySelectedCase(caseItem) {
  if (state.currentCase?.id !== caseItem.id) return;
  const oldStatus = state.currentCase.status;
  state.currentCase = caseItem;
  updateSummary(caseItem);
  updateConversationControls(state.conversation);
  if (caseItem.status !== 'open' && state.videoSession?.caseId === caseItem.id) await state.videoSession.disconnect();
  renderMediaState();
  // interviewStatus is a badge only, never a reason to select a different case.
  if (oldStatus !== 'open' && caseItem.status === 'open' && state.me?.user) {
    try { await watchCall(caseItem.id, state.callRoot); } catch (error) { showMediaError(error); }
  }
}

function getVideoSession() {
  if (!state.videoSession) {
    if (!window.ReportVideoSession) throw new Error('視訊控制器尚未載入，請重新整理後再試。');
    state.videoSession = new window.ReportVideoSession({
      getToken: (caseId) => {
        requireOpenRoot(caseId, state.callRoot);
        return api(casePath(caseId, '/agora-token'), { method: 'POST' });
      },
      onChange: () => renderMediaState(),
      onError: (error) => { controllerErrors.add(error); renderMediaState(); }
    });
  }
  return state.videoSession;
}

function showMediaError(error) {
  if (error?.name === 'AbortError') return;
  if (!controllerErrors.has(error)) state.mediaError = errorText(error);
  renderMediaState();
}

function renderMedia(root, caseItem) {
  state.callRoot = root;
  root.dataset.caseId = String(caseItem.id);
  const staff = Boolean(state.me?.user);
  root.innerHTML = `<div class="section-heading"><h2>視訊筆錄</h2></div>
    <div class="media-grid"><div class="media-controls">
      <div data-slot="videoGrid" class="video-grid video-pair">
        <div class="video-tile"><div data-slot="localVideoSlot" class="video-slot"><div data-slot="localPlayer" class="video-player"></div></div><div data-slot="localLabel" class="video-label">我方（未開啟鏡頭／麥克風）</div></div>
        <div data-slot="remotePlaceholder" class="video-tile"><div class="video-slot video-placeholder"><p>${staff ? '等待民眾傳送視訊' : '等待客服加入'}</p></div><div class="video-label">對方（尚未傳送）</div></div>
      </div>
      <p data-slot="callStatus" class="call-status" role="status" aria-live="polite"></p>
      <p data-slot="recordingNotice" class="recording-notice">錄影尚未啟用</p>
      <p class="muted">本頁不會自動錄影；錄影功能須另行確認並取得明確同意後才可啟用。</p>
      <div data-slot="mediaError" class="notice error" role="status" aria-live="polite" hidden></div>
      <div class="button-row">
        ${staff ? '' : '<button type="button" data-action="joinCall" class="warning">開始視訊報案</button><button type="button" data-action="leaveCall" class="danger">結束筆錄</button>'}
        <button type="button" data-action="toggleVideo" class="secondary" aria-pressed="false">開啟鏡頭</button>
        <button type="button" data-action="toggleAudio" class="secondary" aria-pressed="false">開啟麥克風</button>
        <button type="button" data-action="retryMedia" class="secondary" hidden>重試視訊</button>
        <button type="button" data-action="resumeAudio" class="secondary">播放聲音</button>
      </div>
    </div></div>`;
  const mediaAction = (operation) => runMediaAction(caseItem.id, root, operation).catch(showMediaError);
  $('[data-action="joinCall"]', root)?.addEventListener('click', () => mediaAction(() => joinCall(caseItem.id, true, false, root)));
  $('[data-action="leaveCall"]', root)?.addEventListener('click', () => mediaAction(() => leaveCall(caseItem.id, true)));
  for (const [action, kind] of [['toggleVideo', 'video'], ['toggleAudio', 'audio']]) {
    $(`[data-action="${action}"]`, root).addEventListener('click', () => mediaAction(async () => {
      const session = getVideoSession();
      const enabled = !session.tracks.has(kind);
      if (enabled) await session.connect(caseItem.id, root);
      await session.setDevice(kind, enabled);
      if (!staff) await updateStatementStatus(caseItem.id, session.hasLocalMedia);
    }));
  }
  $('[data-action="retryMedia"]', root).addEventListener('click', () => mediaAction(() => staff
    ? watchCall(caseItem.id, root) : joinCall(caseItem.id, true, false, root)));
  $('[data-action="resumeAudio"]', root).addEventListener('click', () => {
    if (!isCurrentRoot(caseItem.id, root)) return;
    // Do not queue: audio.play() must execute inside this user gesture.
    const session = state.videoSession;
    if (!session) return;
    session.resumeAudio().catch(showMediaError);
  });
  renderMediaState();
}

function renderMediaState() {
  const root = state.callRoot;
  if (!isCurrentRoot(state.currentCase?.id, root)) return;
  const session = state.videoSession;
  const same = session?.caseId === state.currentCase.id;
  const connected = Boolean(same && session.connected);
  const busy = state.mediaPending || Boolean(session?.busy);
  const open = state.currentCase.status === 'open';
  // Failed connect cleans caseId/root before reporting its error.
  const error = state.mediaError || ((same || session?.caseId === null) && session.lastError ? errorText(session.lastError) : '');
  const placeholder = $('[data-slot="remotePlaceholder"]', root);
  // CSS's .video-tile display rules must not make a hidden waiting tile visible.
  placeholder?.classList.toggle('hidden', Boolean(placeholder.hidden));
  const status = $('[data-slot="callStatus"]', root);
  if (status) status.textContent = !open ? '案件尚未開通或已結案，視訊未連線。' :
    session?.status === 'disconnecting' ? '正在中斷連線…' :
    same && session.status === 'reconnecting' ? '網路暫時中斷，正在重新連線…' :
    same && session.status === 'connecting' ? '視訊連線中…' :
    error ? (connected ? '連線仍在，部分功能發生錯誤；請查看下方說明。' : '視訊連線失敗，請重試。') :
    connected ? (placeholder?.hidden ? '已連線，正在接收對方視訊／語音。' : '已連線，等待對方視訊／語音。') : '尚未連線。';
  const recording = $('[data-slot="recordingNotice"]', root);
  if (recording) recording.textContent = connected ? '視訊筆錄進行中｜錄影尚未啟用' : '錄影尚未啟用';
  const errorNode = $('[data-slot="mediaError"]', root);
  if (errorNode) { errorNode.textContent = error ? `${error} 請確認瀏覽器權限後重試；裝置可分別開關。` : ''; errorNode.hidden = !error; }
  for (const [action, kind, label] of [['toggleVideo', 'video', '鏡頭'], ['toggleAudio', 'audio', '麥克風']]) {
    const button = $(`[data-action="${action}"]`, root);
    const enabled = Boolean(same && session.tracks.has(kind));
    if (button) { button.textContent = `${enabled ? '關閉' : '開啟'}${label}`; button.setAttribute('aria-pressed', String(enabled)); button.disabled = busy || !open; }
  }
  const start = $('[data-action="joinCall"]', root);
  if (start) start.disabled = busy || !open || Boolean(connected && session.tracks.has('video') && session.tracks.has('audio'));
  const stop = $('[data-action="leaveCall"]', root);
  if (stop) stop.disabled = busy || !(connected || state.currentCase.interviewStatus === 'active');
  const retry = $('[data-action="retryMedia"]', root);
  if (retry) { retry.hidden = !error; retry.disabled = busy || !open; }
  const audio = $('[data-action="resumeAudio"]', root);
  if (audio) { audio.disabled = !connected; audio.textContent = session?.audioBlocked ? '播放聲音（瀏覽器已阻擋）' : '播放聲音'; }
  const label = $('[data-slot="localLabel"]', root);
  if (label) label.textContent = `我方（鏡頭${same && session.tracks.has('video') ? '已開啟' : '未開啟'}／麥克風${same && session.tracks.has('audio') ? '已開啟' : '未開啟'}）`;
}

function runMediaAction(caseId, root, operation) {
  return enqueueWorkflow(async () => {
    requireOpenRoot(caseId, root);
    state.mediaPending = true;
    renderMediaState();
    try { return await operation(); } finally { state.mediaPending = false; renderMediaState(); }
  });
}

async function watchCall(caseId, root = state.callRoot) {
  requireOpenRoot(caseId, root);
  await getVideoSession().connect(caseId, root);
}

// Compatibility wrappers; all media ownership stays in ReportVideoSession.
async function joinCall(caseId, markStatement = false, _unused = false, root = state.callRoot) {
  requireOpenRoot(caseId, root);
  const session = getVideoSession();
  await session.connect(caseId, root);
  let mediaFailure;
  try { await session.publishBoth(); } catch (error) { mediaFailure = error; }
  if (markStatement && !state.me?.user && session.hasLocalMedia) {
    try { await updateStatementStatus(caseId, true); } catch (error) {
      if (!mediaFailure) throw error;
      showMediaError(error);
    }
  }
  if (mediaFailure) throw mediaFailure;
}

async function leaveCall(caseId, markStatement = false) {
  if (state.videoSession?.caseId === caseId) await state.videoSession.disconnect();
  if (markStatement && !state.me?.user) await updateStatementStatus(caseId, false);
  state.mediaError = '';
  renderMediaState();
}

async function disconnectCurrent() {
  const caseId = state.currentCase?.id;
  const citizenActive = !state.me?.user && state.currentCase?.status === 'open' &&
    (state.videoSession?.connected || state.currentCase?.interviewStatus === 'active');
  if (state.videoSession) await state.videoSession.disconnect();
  if (caseId && citizenActive) await updateStatementStatus(caseId, false);
}

async function updateStatementStatus(caseId, active) {
  const data = await api(casePath(caseId, '/statement'), postOptions({ active }));
  if (!data.case || data.case.id !== caseId) throw new Error('筆錄狀態更新結果不完整，請重試。');
  state.caseRevision += 1;
  if (state.currentCase?.id === caseId) {
    state.currentCase = data.case;
    updateSummary(data.case);
    renderMediaState();
  }
}

function validConversation(context) {
  return Boolean(context && context === state.conversation && context.version === state.viewVersion &&
    context.root.isConnected && context.root.dataset.caseId === String(context.caseId) && state.currentCase?.id === context.caseId);
}

function renderConversation(root, caseItem) {
  root.innerHTML = `<div class="section-heading"><h2>案件訊息紀錄</h2></div>
    <div class="chat-log" role="log" aria-label="案件訊息與附件" aria-live="polite" style="overflow-anchor:none"></div>
    <div data-slot="conversationPollError" class="notice error" role="status" hidden></div>
    <form class="message-form"><textarea name="body" placeholder="輸入訊息" aria-label="訊息" required></textarea><button type="submit">送出</button></form>
    <form class="upload-form stacked-form"><label>上傳資料（每個檔案最多 3 MiB）<input name="file" type="file" required></label><button type="submit">上傳資料</button></form>
    <p data-slot="uploadStatus" class="muted"></p>`;
  const context = { caseId: caseItem.id, version: state.viewVersion, root, events: new Map(), nodes: new Map(), polling: null, sending: false, uploading: false };
  state.conversation = context;
  $('.message-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validConversation(context) || context.sending) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem('body');
    const original = input.value;
    if (!original.trim()) return;
    context.sending = true;
    updateConversationControls(context);
    inlineNotice(form, '');
    try {
      await postMessage(caseItem.id, original.trim(), context);
      if (validConversation(context) && input.value === original) input.value = '';
    } catch (error) { if (validConversation(context)) reportActionError(error, form); }
    finally { context.sending = false; updateConversationControls(context); }
  });
  $('.upload-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validConversation(context) || context.uploading || state.currentCase.status !== 'open') return;
    const form = event.currentTarget;
    const input = form.elements.namedItem('file');
    const file = input.files[0];
    if (!file) return;
    context.uploading = true;
    updateConversationControls(context);
    inlineNotice(form, '');
    try {
      await uploadVideo(caseItem.id, file, file.name, 'upload', context);
      if (validConversation(context) && input.files[0] === file) form.reset();
    } catch (error) { if (validConversation(context)) reportActionError(error, form); }
    finally { context.uploading = false; updateConversationControls(context); }
  });
  updateConversationControls(context);
  startMessagePolling(caseItem.id);
  void refreshMessages(caseItem.id);
}

function updateConversationControls(context) {
  if (!validConversation(context)) return;
  const open = state.currentCase.status === 'open';
  const submit = $('.message-form button[type="submit"]', context.root);
  if (submit) { submit.disabled = context.sending; submit.textContent = context.sending ? '傳送中…' : '送出'; }
  const upload = $('.upload-form button[type="submit"]', context.root);
  if (upload) { upload.disabled = context.uploading || !open; upload.textContent = context.uploading ? '上傳中…' : '上傳資料'; }
  const input = $('.upload-form input', context.root);
  if (input) input.disabled = context.uploading || !open;
  const status = $('[data-slot="uploadStatus"]', context.root);
  if (status) status.textContent = open ? '附件會與訊息依時間排列；單檔上限 3 MiB（配合平台請求限制）。' : '案件開通後才可上傳或讀取附件；訊息仍可查看。';
}

function eventKey(kind, item) { return `${kind}:${item.id}`; }

function mergeConversation(context, messages = [], files = []) {
  if (!validConversation(context)) return;
  let changed = false;
  for (const [kind, items] of [['message', messages], ['file', files]]) {
    for (const item of items) {
      if (!item?.id || (item.caseId && item.caseId !== context.caseId)) continue;
      const key = eventKey(kind, item);
      if (context.events.has(key)) continue;
      context.events.set(key, { key, kind, item });
      changed = true;
    }
  }
  if (!changed) return;
  const log = $('.chat-log', context.root);
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
  const viewportTop = log.getBoundingClientRect().top;
  const anchor = [...log.children].find((node) => node.getBoundingClientRect().bottom > viewportTop);
  const anchorTop = anchor?.getBoundingClientRect().top;
  const scrollTop = log.scrollTop;
  const events = [...context.events.values()].sort((a, b) =>
    ((Date.parse(a.item.createdAt) || 0) - (Date.parse(b.item.createdAt) || 0)) || a.key.localeCompare(b.key));
  events.forEach((event, index) => {
    let node = context.nodes.get(event.key);
    if (!node) {
      node = event.kind === 'message' ? messageElement(event.item) : fileElement(event.item);
      context.nodes.set(event.key, node);
    }
    if (log.children[index] !== node) log.insertBefore(node, log.children[index] || null);
  });
  if (atBottom) log.scrollTop = log.scrollHeight;
  else log.scrollTop = anchor ? scrollTop + anchor.getBoundingClientRect().top - anchorTop : scrollTop;
}

function messageElement(message) {
  const mine = state.me?.user ? ['agent', 'admin'].includes(message.senderType) : message.senderType === 'citizen';
  const item = document.createElement('div');
  item.className = `message ${mine ? 'mine' : ''} ${message.senderType === 'system' ? 'system' : ''}`;
  item.innerHTML = `<small>${escapeHtml(message.senderName)} · ${escapeHtml(formatTime(message.createdAt))}</small><div>${escapeHtml(displayMessage(message.body))}</div>`;
  return item;
}

function safeFileUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('#')) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch (_) { return null; }
}

function formatSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return '大小未提供';
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(2)} MiB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${size} B`;
}

function fileElement(file) {
  const item = document.createElement('div');
  item.className = 'message file-message file-item';
  const url = safeFileUrl(file.url);
  const name = escapeHtml(file.originalName || '附件');
  item.innerHTML = `${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${name}</a>` : `<strong>${name}</strong><span>（連結無效，無法開啟）</span>`}
    <div class="muted">${escapeHtml(formatSize(file.size))} · 上傳者：${escapeHtml(file.uploadedBy || '未提供')} · ${escapeHtml(formatTime(file.createdAt))}</div>`;
  return item;
}

async function postMessage(caseId, body, context = state.conversation) {
  if (!validConversation(context) || context.caseId !== caseId) throw new Error('案件已切換，訊息尚未傳送。');
  const { message } = await api(casePath(caseId, '/messages'), postOptions({ body }));
  if (!message?.id) throw new Error('訊息傳送結果不完整，請確認紀錄後再重試。');
  mergeConversation(context, [message]);
}

function startMessagePolling(caseId) {
  clearInterval(state.messagePollTimer);
  state.messagePollTimer = setInterval(() => { void refreshMessages(caseId); }, 2500);
}

function refreshMessages(caseId) {
  const context = state.conversation;
  if (!validConversation(context) || context.caseId !== caseId) return Promise.resolve();
  if (context.polling) return context.polling;
  const includeFiles = state.currentCase.status === 'open';
  const request = async () => {
    const results = await Promise.allSettled([
      api(casePath(caseId, '/messages')),
      includeFiles ? api(casePath(caseId, '/files')) : Promise.resolve({ files: [] })
    ]);
    if (!validConversation(context)) return;
    const errors = [];
    const arrays = results.map((result, index) => {
      if (result.status === 'rejected') { errors.push(errorText(result.reason)); return []; }
      const items = result.value[index === 0 ? 'messages' : 'files'];
      if (!Array.isArray(items)) { errors.push('訊息或附件回應格式錯誤。'); return []; }
      return items;
    });
    mergeConversation(context, arrays[0], arrays[1]);
    inlineNotice(context.root, [...new Set(errors)].join('；'), 'conversationPollError');
  };
  context.polling = request().catch((error) => {
    if (validConversation(context)) inlineNotice(context.root, errorText(error), 'conversationPollError');
  }).finally(() => { context.polling = null; });
  return context.polling;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('讀取檔案失敗。'));
    reader.onabort = () => reject(new Error('讀取檔案已取消。'));
    reader.readAsDataURL(file);
  });
}

async function uploadVideo(caseId, file, fileName, _kind = 'upload', context = state.conversation) {
  if (!file || !Number.isFinite(file.size) || file.size > MAX_UPLOAD_BYTES) throw new Error('單檔上限為 3 MiB；請縮小檔案後再上傳（平台請求大小限制）。');
  if (!file.size) throw new Error('不能上傳空白檔案。');
  if (!validConversation(context) || context.caseId !== caseId || state.currentCase.status !== 'open') throw new Error('案件尚未開通或已切換，無法上傳。');
  const dataUrl = await readFileAsDataUrl(file);
  if (!validConversation(context) || state.currentCase.status !== 'open') throw new Error('案件已切換或無法上傳，檔案尚未送出。');
  const { file: saved } = await api(casePath(caseId, '/files'), postOptions({
    dataUrl, fileName, mimeType: file.type || 'application/octet-stream', size: file.size, kind: 'upload'
  }));
  if (!saved?.id) throw new Error('上傳結果不完整，請確認附件紀錄後再重試。');
  mergeConversation(context, [], [saved]);
}

function loadCases() {
  if (!state.me?.user) return Promise.resolve();
  if (state.caseLoad) return state.caseLoad;
  const revision = state.caseRevision;
  const identity = state.me.user;
  const request = async () => {
    const data = await api('/api/cases');
    if (!Array.isArray(data.cases)) throw new Error('案件列表回應格式錯誤。');
    await enqueueWorkflow(async () => {
      if (identity !== state.me?.user || revision !== state.caseRevision) return;
      state.cases = data.cases;
      renderCaseShell($('#staffWorkspace'), state.cases, false);
      if (state.me.user.role === 'admin') renderCaseShell($('#adminWorkspace'), state.cases, true);
      const selected = state.cases.find((item) => item.id === state.currentCase?.id);
      if (selected) await applySelectedCase(selected);
      // No initial selection, no active-case jumping and no detail reconstruction.
      inlineNotice($('#staffWorkspace'), '', 'caseLoadError');
      inlineNotice($('#adminWorkspace'), '', 'caseLoadError');
    });
    if (identity === state.me?.user && state.me.user.role === 'admin') await renderAdminTools();
  };
  state.caseLoad = request().finally(() => { state.caseLoad = null; });
  return state.caseLoad;
}

function refreshCaseLists() { return loadCases(); }

function startCasePolling() {
  clearInterval(state.casePollTimer);
  state.casePollTimer = setInterval(() => { refreshCaseLists().catch(renderAdminLoadError); }, 3000);
}

function renderAdminLoadError(error) {
  const root = state.me?.user?.role === 'admin' ? $('#adminWorkspace') : $('#staffWorkspace');
  root?.classList.remove('hidden');
  inlineNotice(root, `後台資料載入失敗：${errorText(error)} 系統會繼續重試。`, 'caseLoadError');
  if (root && !$('[data-action="resetStaffSession"]', root)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = 'resetStaffSession';
    button.textContent = '重新登入';
    button.className = 'secondary';
    button.addEventListener('click', () => resetStaffSession().catch((failure) => reportActionError(failure, root)));
    root.appendChild(button);
  }
}

function resetStaffSession() {
  return enqueueWorkflow(async () => {
    await disconnectCurrent();
    await api('/api/staff/logout', { method: 'POST' });
    clearInterval(state.casePollTimer);
    clearInterval(state.messagePollTimer);
    window.location.href = '/admin#admin';
  });
}

async function submitAdminForm(form, operation) {
  const button = $('button[type="submit"]', form);
  if (button.disabled) return;
  button.disabled = true;
  inlineNotice(form, '');
  try { await operation(); } catch (error) { reportActionError(error, form); }
  finally { button.disabled = false; }
}

async function renderAdminTools() {
  const root = $('#adminWorkspace');
  if (!root || $('#createUserForm', root)) return;
  const tools = document.createElement('div');
  tools.className = 'admin-grid';
  tools.innerHTML = `<div class="surface"><h2>預先開通民眾</h2>
    <form id="createCaseForm" class="stacked-form"><label>姓名<input name="citizenName" required></label><label>身分證/居留證號<input name="nationalId" required></label><button type="submit">新增並直接開通</button></form></div>
    <div class="surface"><h2>新增客服/管理員</h2><form id="createUserForm" class="stacked-form">
      <label>顯示姓名<input name="displayName" required></label><label>帳號<input name="username" required></label><label>密碼<input name="password" type="password" autocomplete="new-password" required></label>
      <label>角色<select name="role"><option value="agent">客服</option><option value="admin">管理員</option></select></label><button type="submit">建立帳號</button></form></div>
    <div class="surface"><h2>帳號列表</h2><div id="userList" class="table-list"></div><button type="button" data-action="refreshUsers" class="secondary">重新整理帳號</button></div>`;
  root.appendChild(tools);
  $('#createCaseForm', tools).addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void submitAdminForm(form, async () => {
      const value = (name) => form.elements.namedItem(name).value;
      const data = await api('/api/cases', postOptions({ citizenName: value('citizenName'), nationalId: value('nationalId') }));
      if (!data.case?.id) throw new Error('預先開通結果不完整，請重新整理確認。');
      await enqueueWorkflow(async () => {
        state.caseRevision += 1;
        const index = state.cases.findIndex((item) => item.id === data.case.id);
        if (index < 0) state.cases.unshift(data.case); else state.cases[index] = data.case;
        await applySelectedCase(data.case);
        renderAllCaseLists();
      });
      form.reset();
    });
  });
  $('#createUserForm', tools).addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void submitAdminForm(form, async () => {
      const value = (name) => form.elements.namedItem(name).value;
      await api('/api/users', postOptions({ displayName: value('displayName'), username: value('username'), password: value('password'), role: value('role') }));
      form.reset();
      await renderUserList();
    });
  });
  $('[data-action="refreshUsers"]', tools).addEventListener('click', () => renderUserList().catch((error) => reportActionError(error, tools)));
  await renderUserList().catch((error) => reportActionError(error, tools));
}

async function renderUserList() {
  const list = $('#userList');
  if (!list) return;
  const { users } = await api('/api/users');
  if (!Array.isArray(users)) throw new Error('帳號列表回應格式錯誤。');
  list.innerHTML = '';
  users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `<strong>${escapeHtml(user.displayName)}</strong><div class="muted">${escapeHtml(user.username)} · ${escapeHtml(user.role)}</div>`;
    list.appendChild(row);
  });
}

async function enterCitizen(form) {
  // Check again at the point of entry: another tab may have changed the cookie.
  const me = await api('/api/me');
  if (me.user) { showNotice(IDENTITY_NOTICE, 'error'); return; }
  if (state.videoSession?.hasLocalMedia && !window.confirm('重新進入案件會先關閉目前攝影機與麥克風。是否繼續？')) return;
  await disconnectCurrent();
  const data = await api('/api/citizen/start', postOptions({
    citizenName: form.elements.namedItem('citizenName').value,
    nationalId: form.elements.namedItem('nationalId').value
  }));
  if (!data.case?.id) throw new Error('報案申請結果不完整，請稍後重試。');
  if (data.status !== 'open' || data.case.status !== 'open') {
    showNotice(data.case.status === 'closed' ? '此案件已結案，請聯絡承辦人員。' : '已送出線上報案開通申請，等待審核。審核完成後，請以同一組資料按「我要視訊報案」。');
    return;
  }
  const session = await api('/api/me');
  if (session.user) { showNotice(IDENTITY_NOTICE, 'error'); return; }
  if (session.case?.id !== data.case.id) throw new Error('民眾登入身分驗證失敗，請重新進入案件。');
  state.me = session;
  if (!await selectCaseNow($('#citizenWorkspace'), data.case, false)) return;
  showNotice('已進入線上報案系統，正在連接視訊。');
  state.mediaPending = true;
  state.mediaError = '';
  try { await joinCall(data.case.id, true, false, state.callRoot); }
  catch (error) { showMediaError(error); }
  finally { state.mediaPending = false; renderMediaState(); }
  showNotice('已進入線上報案系統。視訊狀態與權限錯誤會顯示在視訊區，訊息與附件仍可使用。');
}

async function showStaffWorkspace() {
  $('#staffLogin')?.classList.add('hidden');
  $('#staffWorkspace')?.classList.remove('hidden');
  if (state.me.user.role === 'admin') {
    $('#adminWorkspace')?.classList.remove('hidden');
    activatePanel('adminPanel');
  } else activatePanel('staffPanel');
  await loadCases().catch(renderAdminLoadError);
  startCasePolling();
}

async function loginStaff(form) {
  if (state.videoSession?.hasLocalMedia && !window.confirm('登入後台將關閉目前民眾視訊。是否繼續？')) return;
  await disconnectCurrent();
  await api('/api/staff/login', postOptions({ username: form.elements.namedItem('username').value, password: form.elements.namedItem('password').value }));
  const me = await api('/api/me');
  if (!me.user || !['admin', 'agent'].includes(me.user.role)) throw new Error('後台登入驗證失敗，請重新登入。');
  state.me = me;
  state.currentCase = null;
  state.detailRoot = state.callRoot = state.conversation = null;
  state.viewVersion += 1;
  clearInterval(state.messagePollTimer);
  $('#citizenWorkspace')?.classList.add('hidden');
  form.elements.namedItem('password').value = '';
}

$$('.tab-button').forEach((button) => button.addEventListener('click', () => {
  const panel = button.dataset.panel;
  if (panel === 'adminPanel' && state.me?.user?.role !== 'admin') { activatePanel('staffPanel'); return; }
  activatePanel(panel);
}));

$('#citizenForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await bootPromise; await enqueueWorkflow(() => enterCitizen(form)); }
  catch (error) { showNotice(errorText(error), 'error'); }
  finally { if (button) button.disabled = false; }
});

$('#staffLoginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  if (button?.disabled) return;
  if (button) button.disabled = true;
  inlineNotice(form, '');
  try {
    await bootPromise;
    await enqueueWorkflow(() => loginStaff(form));
    if (state.me?.user) await showStaffWorkspace();
  } catch (error) { reportActionError(error, form); }
  finally { if (button) button.disabled = false; }
});

async function boot() {
  const entryMode = document.body.dataset.entry || 'mixed';
  const isAdminPage = entryMode === 'admin' || /^\/admin(?:\.html)?\/?$/.test(window.location.pathname);
  const staffHash = ['#staff', '#admin'].includes(window.location.hash);
  const citizenEntry = entryMode === 'citizen' && !staffHash && !isAdminPage;
  activatePanel(citizenEntry ? 'citizenPanel' : isAdminPage || staffHash ? 'staffPanel' : 'citizenPanel');
  if (citizenEntry) window.history.replaceState(null, '', window.location.pathname);
  if (isAdminPage) window.history.replaceState(null, '', '/admin#admin');
  state.me = await api('/api/me');
  if (citizenEntry && state.me.user) { showNotice(IDENTITY_NOTICE, 'error'); return; }
  if (state.me.user) await showStaffWorkspace();
  else if (state.me.case) {
    if (state.me.case.status !== 'open') {
      showNotice(state.me.case.status === 'closed' ? '此案件已結案，請聯絡承辦人員。' : '案件尚待審核；開通後請按「我要視訊報案」重新進入。');
      return;
    }
    await renderCitizenWorkspace(state.me.case);
    showNotice('已恢復案件工作區。鏡頭與麥克風尚未開啟，請按「開始視訊報案」。');
  }
}

const bootPromise = boot().catch((error) => {
  if (document.body.dataset.entry === 'citizen' && !['#staff', '#admin'].includes(window.location.hash)) showNotice(errorText(error), 'error');
  else reportActionError(error, $('#staffLogin'));
});