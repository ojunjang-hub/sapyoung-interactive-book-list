'use strict';

const API = CONFIG.API_BASE + '/api';
let adminKey = localStorage.getItem('admin_key') || null;
let currentPage = 1;
const PAGE_SIZE = 50;
let tableItems = [];
let editingIsbn = null;
let editInitial = {};
let filesIsbn = null;

// ─── Utilities ───────────────────────────────────────────────────────────────

// esc()는 util.js에서 전역 제공

function adminHeaders(extra) {
  return { 'X-Admin-Key': adminKey, ...extra };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function checkAuth() {
  const show = (id, visible) => {
    document.getElementById(id).style.display = visible ? '' : 'none';
  };
  if (adminKey) {
    show('login-section', false);
    show('admin-section', true);
    show('btn-logout', true);
  } else {
    show('login-section', true);
    show('admin-section', false);
    show('btn-logout', false);
  }
}

async function login() {
  const key = document.getElementById('admin-key-input').value.trim();
  if (!key) return;
  try {
    const r = await fetch(`${API}/admin/verify`, {
      headers: { 'X-Admin-Key': key },
    });
    if (r.ok) {
      adminKey = key;
      localStorage.setItem('admin_key', key);
      document.getElementById('login-error').style.display = 'none';
      checkAuth();
      init();
    } else {
      document.getElementById('login-error').style.display = 'block';
    }
  } catch {
    document.getElementById('login-error').style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('admin_key');
  adminKey = null;
  checkAuth();
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  await loadDepartments();
  await loadBooks(1);
}

async function loadDepartments() {
  try {
    const r = await fetch(`${API}/filters`);
    const { departments = [], series = [] } = await r.json();

    const deptSel = document.getElementById('dept-filter');
    const datalist = document.getElementById('dept-datalist');
    departments.forEach(d => {
      const o1 = document.createElement('option');
      o1.value = d; o1.textContent = d;
      deptSel.appendChild(o1);

      const o2 = document.createElement('option');
      o2.value = d;
      datalist.appendChild(o2);
    });

    const seriesSel = document.getElementById('series-filter');
    series.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      seriesSel.appendChild(o);
    });
  } catch { /* filters API optional */ }
}

// ─── Books ───────────────────────────────────────────────────────────────────

function search() { loadBooks(1); }

function resetFilters() {
  document.getElementById('q-input').value = '';
  document.getElementById('dept-filter').value = '';
  document.getElementById('series-filter').value = '';
  document.getElementById('status-filter').value = '';
  document.getElementById('card-filter').value = '';
  loadBooks(1);
}

async function loadBooks(page) {
  currentPage = page;
  const params = new URLSearchParams({ page, size: PAGE_SIZE });
  const q = document.getElementById('q-input').value.trim();
  const dept = document.getElementById('dept-filter').value;
  const series = document.getElementById('series-filter').value;
  const status = document.getElementById('status-filter').value;
  const card = document.getElementById('card-filter').value;
  if (q) params.set('q', q);
  if (dept) params.set('department', dept);
  if (series) params.set('series', series);
  if (status) params.set('status_filter', status);
  if (card) params.set('card_status', card);

  document.getElementById('result-bar').textContent = '로딩 중…';
  document.getElementById('admin-tbody').innerHTML =
    '<tr><td colspan="8" class="empty-state">로딩 중…</td></tr>';

  try {
    const r = await fetch(`${API}/admin/books?${params}`, { headers: adminHeaders() });
    if (r.status === 403) { logout(); return; }
    const data = await r.json();
    tableItems = data.items;
    renderTable(data.items);
    renderPagination(data.total, page);
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, data.total);
    document.getElementById('result-bar').textContent =
      `전체 ${data.total.toLocaleString()}권 중 ${from}–${to}권`;
  } catch {
    document.getElementById('result-bar').textContent = '로드 실패';
    document.getElementById('admin-tbody').innerHTML =
      '<tr><td colspan="8" class="empty-state">오류가 발생했습니다.</td></tr>';
  }
}

function statusHtml(s) {
  if (!s) return '<span class="muted">—</span>';
  const cls = { '절판': 'oop', '품절': 'sold-out', '재고있음': 'in-stock' }[s] || '';
  return `<span class="status-chip ${cls}">${esc(s)}</span>`;
}

// 마케팅 카드 상태 배지 (thin/partial/thick)
function cardBadgeHtml(s) {
  const st = s || 'thin';
  return `<span class="card-badge card-${esc(st)}">${esc(st)}</span>`;
}

function renderTable(items) {
  const tbody = document.getElementById('admin-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">결과 없음</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((b, i) => `
    <tr>
      <td class="td-cover">
        <img class="admin-thumb" src="${esc(b.cover_url || '')}" alt=""
             onerror="this.style.visibility='hidden'">
      </td>
      <td class="td-title">
        <strong>${esc(b.title)}</strong>
        <span class="td-sub">${esc(b.author || '')}</span>
        <span class="td-isbn">${esc(b.isbn13)}</span>
      </td>
      <td class="td-date">${esc((b.pub_date || '').slice(0, 7))}</td>
      <td class="td-class">
        <span class="dept-tag">${esc(b.department || '')}</span>
        ${b.category ? `<span class="cat-tag">${esc(b.category)}</span>` : ''}
        ${b.has_override ? '<span class="override-dot" title="오버라이드됨">●</span>' : ''}
      </td>
      <td>${statusHtml(b.stock_status)}</td>
      <td>${cardBadgeHtml(b.card_status)}</td>
      <td><button class="btn-sm" onclick="openEdit(${i})">편집</button></td>
      <td><button class="btn-sm" onclick="openFilesForRow(${i})">파일</button></td>
    </tr>
  `).join('');
}

function renderPagination(total, page) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const nav = document.getElementById('pagination');
  if (totalPages <= 1) { nav.innerHTML = ''; return; }

  const start = Math.max(1, page - 4);
  const end = Math.min(totalPages, page + 4);
  const btns = [];
  if (page > 1) btns.push(`<button onclick="loadBooks(${page - 1})">‹ 이전</button>`);
  for (let p = start; p <= end; p++) {
    btns.push(`<button class="${p === page ? 'active' : ''}" onclick="loadBooks(${p})">${p}</button>`);
  }
  if (page < totalPages) btns.push(`<button onclick="loadBooks(${page + 1})">다음 ›</button>`);
  nav.innerHTML = btns.join('');
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

// 편집 가능한 전체 필드 정의 (순서대로 폼 생성)
const EDIT_FIELDS = [
  { key: 'title', label: '제목', type: 'text' },
  { key: 'subtitle', label: '부제', type: 'text', ph: '제목과 구분되는 부제(없으면 비움)' },
  { key: 'author', label: '저자', type: 'text' },
  { key: 'publisher', label: '출판사', type: 'text' },
  { key: 'pub_date', label: '출간일', type: 'text', ph: 'YYYY-MM-DD' },
  { key: 'series', label: '시리즈', type: 'text' },
  { key: 'pages', label: '쪽수', type: 'number' },
  { key: 'price_standard', label: '정가', type: 'number' },
  { key: 'price_sales', label: '판매가', type: 'number' },
  { key: 'cover_url', label: '표지 URL', type: 'text', ph: 'https://image.aladin.co.kr/…' },
  { key: 'stock_status', label: '재고 상태', type: 'select', options: ['', '재고있음', '품절', '절판'] },
  { key: 'department', label: '부서', type: 'text', list: 'dept-datalist' },
  { key: 'category', label: '분류', type: 'text' },
  { key: 'description', label: '짧은 소개', type: 'rich' },
  { key: 'full_description', label: '책 소개', type: 'rich' },
  { key: 'publisher_description', label: '출판사 서평', type: 'rich' },
  { key: 'author_intro', label: '저자 소개', type: 'rich' },
  { key: 'endorsements', label: '추천사', type: 'rich' },
  { key: 'quotable_phrases', label: '인상적인 구절 (빈 줄로 구분)', type: 'textarea' },
  { key: 'toc', label: '목차', type: 'textarea' },
];

// 마케팅 카드 필드 정의 (편집부가 처음 봐도 알 수 있도록 도움말 placeholder 포함)
const MK_FIELDS = [
  { key: 'obi_copy', label: '띠지 문구', type: 'textarea',
    ph: '출간 당시 띠지에 인쇄된 문구를 원문 그대로.' },
  { key: 'back_cover_copy', label: '뒷표지 문구', type: 'textarea',
    ph: '도서 뒷표지 문구(추천사 포함).' },
  { key: 'promo_copy', label: '카드뉴스 문구', type: 'textarea',
    ph: '출간 시 온라인 서점·인스타그램·페이스북에 올린 홍보 카피.' },
  { key: 'editor_comment', label: '편집자 코멘트', type: 'textarea',
    ph: '이 책을 만든 이유, 뒷이야기, 편집자가 아끼는 지점 (자유 서술).' },
  { key: 'promo_points', label: '홍보 참고 포인트', type: 'textarea',
    ph: '수상, 언론 서평, 교재 채택, 저자 강연·방송, 판권 수출 등.' },
  { key: 'key_quotes', label: '본문 핵심 인용문', type: 'textarea',
    ph: '본문에서 뽑은 핵심 인용문 2~3개 (줄바꿈으로 구분).' },
  { key: 'target_reader', label: '타깃 독자', type: 'text',
    ph: '예: 헌법 교양을 원하는 30~40대 직장인' },
  { key: 'topical_keywords', label: '시사/시즌 키워드', type: 'text',
    ph: '쉼표로 구분. 예: 개헌 논의, 제헌절, 수능' },
  { key: 'promo_priority', label: '홍보 우선순위', type: 'select',
    options: ['일반', '신간', '스테디'] },
  { key: 'source_note', label: '출처 메모', type: 'textarea',
    ph: '예: 띠지·뒷표지는 보도자료 hwp / 인용문은 신규 작성' },
  { key: 'updated_by', label: '수정자', type: 'text', ph: '입력한 사람 이름' },
];

const RT_BTNS = [
  ['bold', '<b>B</b>', '굵게'], ['italic', '<i>I</i>', '기울임'],
  ['underline', '<u>U</u>', '밑줄'],
  ['justifyLeft', '⯇', '왼쪽 정렬'], ['justifyCenter', '☰', '가운데 정렬'],
  ['indent', '⇥', '들여쓰기'], ['outdent', '⇤', '내어쓰기'],
  ['insertUnorderedList', '•', '목록'], ['removeFormat', '✕', '서식 지우기'],
].map(([cmd, html, title]) =>
  `<button type="button" data-cmd="${cmd}" title="${esc(title)}">${html}</button>`).join('');

function fieldValue(book, key) {
  if (key === 'quotable_phrases') {
    const q = book.quotable_phrases;
    if (Array.isArray(q)) return q.join('\n\n');
    return q == null ? '' : String(q);
  }
  const v = book[key];
  return v == null ? '' : String(v);
}

function fieldHtml(f, book) {
  const val = fieldValue(book, f.key);
  if (f.type === 'rich') {
    return `<div class="ef-row ef-full">
      <label>${esc(f.label)}</label>
      <div class="rt-toolbar">${RT_BTNS}</div>
      <div class="rt-editor" id="rt-${f.key}" contenteditable="true"></div>
    </div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="ef-row ef-full">
      <label>${esc(f.label)}</label>
      <textarea class="edit-input" id="ef-${f.key}" rows="5">${esc(val)}</textarea>
    </div>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map(o =>
      `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o || '—')}</option>`).join('');
    return `<div class="ef-row"><label>${esc(f.label)}</label>
      <select class="edit-input" id="ef-${f.key}">${opts}</select></div>`;
  }
  const t = f.type === 'number' ? 'number' : 'text';
  const listAttr = f.list ? ` list="${esc(f.list)}"` : '';
  const ph = f.ph ? ` placeholder="${esc(f.ph)}"` : '';
  return `<div class="ef-row"><label>${esc(f.label)}</label>
    <input class="edit-input" id="ef-${f.key}" type="${t}"${listAttr}${ph} value="${esc(val)}"></div>`;
}

// 저장값 → 에디터 표시 HTML (HTML이면 정제, 평문이면 줄바꿈→<br>)
function toEditorHtml(val) {
  if (!val) return '';
  return looksLikeHtml(val) ? sanitizeHtml(val) : esc(val).replace(/\n/g, '<br>');
}

// 에디터 innerHTML이 사실상 비었는지 (공백/빈 태그만) 판정
function richIsEmpty(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return !tmp.textContent.trim() && !/<(img|ul|ol|table|hr)\b/i.test(html);
}

function bindRichToolbars() {
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  document.querySelectorAll('#edit-form .rt-toolbar button').forEach(btn => {
    btn.onmousedown = e => e.preventDefault();  // 에디터 선택 유지
    btn.onclick = () => { try { document.execCommand(btn.dataset.cmd, false, null); } catch (_) {} };
  });
}

async function openEdit(rowIndex) {
  const b0 = tableItems[rowIndex];
  if (!b0) return;
  editingIsbn = b0.isbn13;
  editInitial = {};
  document.getElementById('edit-modal-title').textContent = b0.title || b0.isbn13;
  document.getElementById('edit-msg').textContent = '';
  switchTab('book');  // 항상 도서 정보 탭에서 시작
  loadMarketing(editingIsbn);  // 마케팅 탭도 병행 로드
  const form = document.getElementById('edit-form');
  form.innerHTML = '<p class="muted">불러오는 중…</p>';
  document.getElementById('edit-modal').style.display = 'flex';

  // 전체 필드 로드 (상세 API가 편집 가능한 컬럼을 모두 반환)
  let book = b0;
  try {
    const r = await fetch(`${API}/books/${encodeURIComponent(editingIsbn)}`, { headers: adminHeaders() });
    if (r.ok) book = await r.json();
  } catch (_) { /* 폴백: 목록 데이터 */ }

  form.innerHTML = EDIT_FIELDS.map(f => fieldHtml(f, book)).join('');

  EDIT_FIELDS.forEach(f => {
    if (f.type === 'rich') {
      const ed = document.getElementById('rt-' + f.key);
      ed.innerHTML = toEditorHtml(fieldValue(book, f.key));
      editInitial[f.key] = sanitizeHtml(ed.innerHTML);
    } else {
      editInitial[f.key] = fieldValue(book, f.key);
    }
  });
  bindRichToolbars();
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function saveEdit() {
  if (!editingIsbn) return;
  const msg = document.getElementById('edit-msg');
  msg.textContent = '저장 중…';
  msg.className = 'modal-msg';

  // 변경된 필드만 수집
  const payload = {};
  for (const f of EDIT_FIELDS) {
    let val;
    if (f.type === 'rich') {
      const ed = document.getElementById('rt-' + f.key);
      val = sanitizeHtml(ed ? ed.innerHTML : '');
      if (richIsEmpty(val)) val = '';
    } else {
      const el = document.getElementById('ef-' + f.key);
      val = el ? el.value.trim() : '';
    }
    if (val === (editInitial[f.key] ?? '')) continue;  // 변경 없음
    payload[f.key] = (f.type === 'number') ? (val === '' ? null : Number(val)) : val;
  }

  if (!Object.keys(payload).length) { msg.textContent = '변경 사항 없음'; return; }

  try {
    const r = await fetch(`${API}/admin/books/${encodeURIComponent(editingIsbn)}`, {
      method: 'PATCH',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      msg.textContent = '저장 완료';
      msg.className = 'modal-msg success';
      setTimeout(() => { closeModal('edit-modal'); loadBooks(currentPage); }, 700);
    } else {
      const e = await r.json().catch(() => ({}));
      msg.textContent = `저장 실패: ${e.detail || r.status}`;
      msg.className = 'modal-msg error';
    }
  } catch {
    msg.textContent = '저장 중 오류 발생';
    msg.className = 'modal-msg error';
  }
}

async function resetOverride() {
  if (!editingIsbn || !confirm('분류 오버라이드를 초기화하고 원본으로 되돌립니까?')) return;
  const msg = document.getElementById('edit-msg');
  try {
    const r = await fetch(`${API}/admin/overrides/${editingIsbn}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (r.ok) {
      msg.textContent = '초기화 완료';
      msg.className = 'modal-msg success';
      setTimeout(() => { closeModal('edit-modal'); loadBooks(currentPage); }, 700);
    } else {
      msg.textContent = '초기화 실패';
      msg.className = 'modal-msg error';
    }
  } catch {
    msg.textContent = '오류 발생';
    msg.className = 'modal-msg error';
  }
}

// ─── Marketing Card Tab ──────────────────────────────────────────────────────

let mkInitial = {};

function switchTab(name) {
  document.querySelectorAll('#edit-modal .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.getElementById('tab-book').classList.toggle('active', name === 'book');
  document.getElementById('tab-marketing').classList.toggle('active', name === 'marketing');
}

function mkFieldHtml(f, card) {
  const val = card[f.key] == null ? '' : String(card[f.key]);
  if (f.type === 'select') {
    const opts = f.options.map(o =>
      `<option value="${esc(o)}"${o === (val || '일반') ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="ef-row"><label>${esc(f.label)}</label>
      <select class="edit-input" id="mk-${f.key}">${opts}</select></div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="ef-row ef-full">
      <label>${esc(f.label)}</label>
      <textarea class="edit-input" id="mk-${f.key}" rows="3"
        placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>
    </div>`;
  }
  const ph = f.ph ? ` placeholder="${esc(f.ph)}"` : '';
  return `<div class="ef-row"><label>${esc(f.label)}</label>
    <input class="edit-input" id="mk-${f.key}" type="text"${ph} value="${esc(val)}"></div>`;
}

function renderMkBadge(status) {
  const st = status || 'thin';
  const html = `<span class="card-badge card-${esc(st)}">${esc(st)}</span>`;
  document.getElementById('mk-badge').innerHTML = html;
  document.getElementById('mk-badge-tab').innerHTML = html;
}

async function loadMarketing(isbn) {
  const form = document.getElementById('mk-form');
  document.getElementById('mk-msg').textContent = '';
  form.innerHTML = '<p class="muted">불러오는 중…</p>';
  renderMkBadge(null);
  let card = {};
  try {
    const r = await fetch(`${API}/admin/marketing/${encodeURIComponent(isbn)}`,
      { headers: adminHeaders() });
    if (r.status === 403) { logout(); return; }
    if (r.ok) card = await r.json();
  } catch (_) { /* 빈 카드로 폴백 */ }

  form.innerHTML = MK_FIELDS.map(f => mkFieldHtml(f, card)).join('');
  mkInitial = {};
  MK_FIELDS.forEach(f => { mkInitial[f.key] = card[f.key] == null ? '' : String(card[f.key]); });
  renderMkBadge(card.card_status);
}

async function saveMarketing() {
  if (!editingIsbn) return;
  const msg = document.getElementById('mk-msg');
  msg.textContent = '저장 중…';
  msg.className = 'modal-msg';

  // 변경된 필드만 수집
  const payload = {};
  for (const f of MK_FIELDS) {
    const el = document.getElementById('mk-' + f.key);
    const val = el ? el.value.trim() : '';
    if (val === (mkInitial[f.key] ?? '')) continue;
    payload[f.key] = val;
  }

  if (!Object.keys(payload).length) { msg.textContent = '변경 사항 없음'; return; }

  try {
    const r = await fetch(`${API}/admin/marketing/${encodeURIComponent(editingIsbn)}`, {
      method: 'PUT',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      const data = await r.json();
      const card = data.card || {};
      msg.textContent = '저장 완료';
      msg.className = 'modal-msg success';
      // 배지·초기값 갱신 후 목록도 새로고침(카드 컬럼 반영)
      MK_FIELDS.forEach(f => { mkInitial[f.key] = card[f.key] == null ? '' : String(card[f.key]); });
      renderMkBadge(card.card_status);
      loadBooks(currentPage);
    } else {
      const e = await r.json().catch(() => ({}));
      msg.textContent = `저장 실패: ${e.detail || r.status}`;
      msg.className = 'modal-msg error';
    }
  } catch {
    msg.textContent = '저장 중 오류 발생';
    msg.className = 'modal-msg error';
  }
}

// ─── Files Modal ──────────────────────────────────────────────────────────────

function openFilesForRow(rowIndex) {
  const b = tableItems[rowIndex];
  if (!b) return;
  openFiles(b.isbn13, b.title);
}

async function openFiles(isbn, title) {
  filesIsbn = isbn;
  document.getElementById('files-modal-title').textContent = title;
  document.getElementById('files-msg').textContent = '';
  document.getElementById('upload-file').value = '';
  document.getElementById('upload-type').value = '';
  document.getElementById('upload-desc').value = '';
  document.getElementById('upload-ver').value = '';
  document.getElementById('files-modal').style.display = 'flex';
  await renderFilesList();
}

async function renderFilesList() {
  const listEl = document.getElementById('files-list');
  listEl.textContent = '로딩 중…';
  try {
    const r = await fetch(`${API}/books/${filesIsbn}`, { headers: adminHeaders() });
    const data = await r.json();
    const attachments = data.attachments || [];
    if (!attachments.length) {
      listEl.innerHTML = '<p class="muted">첨부파일 없음</p>';
      return;
    }
    listEl.innerHTML = attachments.map(a => `
      <div class="file-item">
        <div class="file-info">
          <span class="file-type-tag">${esc(a.file_type || '파일')}</span>
          <a href="${esc(API)}/books/${esc(filesIsbn)}/attachments/${a.id}" download="${esc(a.filename || '')}">${esc(a.filename)}</a>
          ${a.version ? `<span class="muted">v${esc(a.version)}</span>` : ''}
          ${a.description ? `<span class="muted">— ${esc(a.description)}</span>` : ''}
          <span class="muted file-date">${esc((a.uploaded_at || '').slice(0, 10))}</span>
        </div>
        <button class="btn-sm btn-danger" onclick="deleteFile(${a.id})">삭제</button>
      </div>
    `).join('');
  } catch {
    listEl.textContent = '로드 실패';
  }
}

async function uploadFile() {
  const fileInput = document.getElementById('upload-file');
  const fileType = document.getElementById('upload-type').value.trim();
  const desc = document.getElementById('upload-desc').value.trim();
  const ver = document.getElementById('upload-ver').value.trim();
  const msg = document.getElementById('files-msg');

  if (!fileInput.files.length) { msg.textContent = '파일을 선택하세요.'; return; }
  if (!fileType) { msg.textContent = '유형을 입력하세요.'; return; }

  const form = new FormData();
  form.append('file', fileInput.files[0]);
  form.append('file_type', fileType);
  form.append('description', desc);
  form.append('version', ver);

  msg.textContent = '업로드 중…';
  msg.className = 'modal-msg';
  try {
    const r = await fetch(`${API}/books/${filesIsbn}/attachments`, {
      method: 'POST',
      headers: adminHeaders(),
      body: form,
    });
    if (r.ok) {
      msg.textContent = '업로드 완료';
      msg.className = 'modal-msg success';
      fileInput.value = '';
      await renderFilesList();
    } else {
      const err = await r.json().catch(() => ({}));
      msg.textContent = `업로드 실패: ${err.detail || r.status}`;
      msg.className = 'modal-msg error';
    }
  } catch {
    msg.textContent = '업로드 중 오류';
    msg.className = 'modal-msg error';
  }
}

async function deleteFile(attachId) {
  if (!confirm('이 파일을 삭제합니까?')) return;
  const msg = document.getElementById('files-msg');
  try {
    const r = await fetch(`${API}/books/${filesIsbn}/attachments/${attachId}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (r.ok) {
      msg.textContent = '삭제 완료';
      msg.className = 'modal-msg success';
      await renderFilesList();
    } else {
      msg.textContent = '삭제 실패';
      msg.className = 'modal-msg error';
    }
  } catch {
    msg.textContent = '오류 발생';
    msg.className = 'modal-msg error';
  }
}

// ─── Keyboard ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('edit-modal');
    closeModal('files-modal');
  }
});

// ─── 신간 추가 ───────────────────────────────────────────────────────────────

async function addBookByIsbn() {
  const input  = document.getElementById('add-isbn-input');
  const result = document.getElementById('add-book-result');
  const isbn   = input.value.trim().replace(/-/g, '');

  if (!isbn) return;
  result.className = 'add-book-result';
  result.textContent = '알라딘에서 도서 정보를 가져오는 중…';

  try {
    const resp = await fetch(`${API}/admin/books/add`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ isbn13: isbn }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      result.className = 'add-book-result error';
      result.textContent = data.detail || `오류 (${resp.status})`;
      return;
    }
    result.className = 'add-book-result success';
    result.textContent = (data.action === 'updated' ? '덮어쓰기 완료' : '추가 완료')
      + `: 『${data.title}』`;
    input.value = '';
    search();  // 목록 새로고침
  } catch (e) {
    result.className = 'add-book-result error';
    result.textContent = `네트워크 오류: ${e.message}`;
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

checkAuth();
if (adminKey) init();
