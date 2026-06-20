'use strict';

const API = CONFIG.API_BASE + '/api';
let adminKey = localStorage.getItem('admin_key') || null;
let currentPage = 1;
const PAGE_SIZE = 50;
let tableItems = [];
let editingIsbn = null;
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
    const { departments = [] } = await r.json();

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
  } catch { /* filters API optional */ }
}

// ─── Books ───────────────────────────────────────────────────────────────────

function search() { loadBooks(1); }

function resetFilters() {
  document.getElementById('q-input').value = '';
  document.getElementById('dept-filter').value = '';
  document.getElementById('status-filter').value = '';
  loadBooks(1);
}

async function loadBooks(page) {
  currentPage = page;
  const params = new URLSearchParams({ page, size: PAGE_SIZE });
  const q = document.getElementById('q-input').value.trim();
  const dept = document.getElementById('dept-filter').value;
  const status = document.getElementById('status-filter').value;
  if (q) params.set('q', q);
  if (dept) params.set('department', dept);
  if (status) params.set('status_filter', status);

  document.getElementById('result-bar').textContent = '로딩 중…';
  document.getElementById('admin-tbody').innerHTML =
    '<tr><td colspan="7" class="empty-state">로딩 중…</td></tr>';

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
      '<tr><td colspan="7" class="empty-state">오류가 발생했습니다.</td></tr>';
  }
}

function statusHtml(s) {
  if (!s) return '<span class="muted">—</span>';
  const cls = { '절판': 'oop', '품절': 'sold-out', '재고있음': 'in-stock' }[s] || '';
  return `<span class="status-chip ${cls}">${esc(s)}</span>`;
}

function renderTable(items) {
  const tbody = document.getElementById('admin-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">결과 없음</td></tr>';
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

function openEdit(rowIndex) {
  const b = tableItems[rowIndex];
  if (!b) return;
  editingIsbn = b.isbn13;
  document.getElementById('edit-modal-title').textContent = b.title;
  document.getElementById('edit-dept').value = b.department || '';
  document.getElementById('edit-cat').value = b.category || '';
  document.getElementById('edit-status').value = b.stock_status || '';
  document.getElementById('edit-cover').value = b.cover_url || '';
  document.getElementById('edit-msg').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function saveEdit() {
  if (!editingIsbn) return;
  const dept = document.getElementById('edit-dept').value.trim();
  const cat = document.getElementById('edit-cat').value.trim();
  const status = document.getElementById('edit-status').value;
  const cover = document.getElementById('edit-cover').value.trim();
  const msg = document.getElementById('edit-msg');

  msg.textContent = '저장 중…';
  msg.className = 'modal-msg';

  try {
    const reqs = [];

    if (dept || cat) {
      reqs.push(fetch(`${API}/admin/books/${editingIsbn}/classification`, {
        method: 'PATCH',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ department: dept || null, category: cat || null }),
      }));
    }
    if (status) {
      reqs.push(fetch(`${API}/admin/books/${editingIsbn}/status`, {
        method: 'PATCH',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ stock_status: status }),
      }));
    }
    if (cover) {
      reqs.push(fetch(`${API}/admin/books/${editingIsbn}/cover`, {
        method: 'PATCH',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cover_url: cover }),
      }));
    }

    if (!reqs.length) { msg.textContent = '변경 사항 없음'; return; }

    const results = await Promise.all(reqs);
    if (results.some(r => !r.ok)) {
      msg.textContent = '일부 항목 저장 실패';
      msg.className = 'modal-msg error';
    } else {
      msg.textContent = '저장 완료';
      msg.className = 'modal-msg success';
      setTimeout(() => { closeModal('edit-modal'); loadBooks(currentPage); }, 700);
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
    result.textContent = `추가 완료: 『${data.title}』`;
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
