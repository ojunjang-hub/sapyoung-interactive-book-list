'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 임시 보관함 (localStorage 기반, 로그인 없음)
//  - book_id = isbn13, 최대 50권, 담긴 순서 유지
//  - window.Shelf 상태 모듈 + 토스트 + 우상단 런처/배지 + 슬라이드 오버레이 패널
//  - util.js(esc) / config.js(CONFIG) 뒤, main.js/book.js 앞에서 로드된다.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const KEY = 'sapyoung_shelf';
  const MAX = 50;

  // ── 상태 로드/정규화 (손상 값 → 빈 배열) ──
  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (_) { return []; }
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const s = String(v == null ? '' : v).trim();
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
    return out.slice(0, MAX);
  }

  let cache = load();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (_) {}
  }

  function emit() {
    document.dispatchEvent(new CustomEvent('shelf:change', { detail: { list: cache.slice() } }));
  }

  // ── 공개 API ──
  const Shelf = {
    list()  { return cache.slice(); },
    count() { return cache.length; },
    has(id) { return cache.indexOf(String(id)) !== -1; },
    add(id) {
      id = String(id == null ? '' : id).trim();
      if (!id) return false;
      if (this.has(id)) return true;              // 중복 no-op (이미 담김 = 성공)
      if (cache.length >= MAX) {
        toast('보관함은 최대 50권까지 담을 수 있습니다');
        return false;
      }
      cache.push(id);
      persist(); emit();
      return true;
    },
    remove(id) {
      id = String(id == null ? '' : id).trim();
      const i = cache.indexOf(id);
      if (i === -1) return false;
      cache.splice(i, 1);
      persist(); emit();
      return true;
    },
    toggle(id) {
      return this.has(id) ? (this.remove(id), false) : this.add(id);
    },
    clear() {
      if (!cache.length) return;
      cache = [];
      persist(); emit();
    },
    // 순서 재배치: 현재 담긴 id만 유효(누락분은 기존 순서로 뒤에 보존).
    // 순서가 실제로 바뀐 경우에만 persist/emit 하고 true 반환.
    reorder(ids) {
      if (!Array.isArray(ids)) return false;
      const cur = new Set(cache);
      const seen = new Set();
      const out = [];
      for (const v of ids) {
        const s = String(v == null ? '' : v).trim();
        if (s && cur.has(s) && !seen.has(s)) { seen.add(s); out.push(s); }
      }
      for (const s of cache) { if (!seen.has(s)) out.push(s); }  // 안전: 누락분 보존
      if (out.length === cache.length && out.every((v, i) => v === cache[i])) return false;
      cache = out;
      persist(); emit();
      return true;
    },
  };
  window.Shelf = Shelf;

  // 조회 결과에 없는 id(비공개/삭제)를 조용히 정리 — 한 번에 반영
  function prune(ids) {
    if (!ids || !ids.length) return;
    const drop = new Set(ids.map(String));
    const before = cache.length;
    cache = cache.filter(x => !drop.has(x));
    if (cache.length !== before) { persist(); emit(); }
  }

  // 다른 탭 동기화
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    cache = load();
    emit();
  });

  // ── 토스트 (하단 중앙, 은은한 fade) ──
  let toastEl = null;
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'shelf-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.remove('show');
    // 강제 리플로우 후 표시 → 재호출 시에도 전환 발생
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.classList.remove('show'); }, 2200);
  }

  // ── 도서 메타데이터 확보 (패널용) ──
  let catalogCache = null;
  async function getCatalog() {
    if (Array.isArray(window.allBooks) && window.allBooks.length) return window.allBooks;
    if (catalogCache) return catalogCache;
    let list = [];
    try {
      const base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE != null) ? CONFIG.API_BASE : '';
      const resp = await fetch(`${base}/api/books?size=2000`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      list = Array.isArray(data) ? data : (data.items || []);
    } catch (_) {
      try {
        const resp = await fetch('data/books.json');
        if (!resp.ok) throw new Error('json');
        const raw = await resp.json();
        list = Array.isArray(raw) ? raw : (raw.items || []);
      } catch (_2) { list = []; }
    }
    catalogCache = list;
    return list;
  }

  // ── 런처 + 배지 + 오버레이 패널 주입 ──
  let launcher, backdrop, panel;
  let dragEl = null;                        // 드래그 중인 항목
  let sortState = { key: null, dir: 'asc' };  // 활성 정렬 기준/방향

  // 드래그 중 커서 y 기준, 삽입 지점(바로 아래 항목) 계산
  function dragAfterElement(container, y) {
    const els = Array.from(container.querySelectorAll('.shelf-item:not(.dragging)'));
    let closest = null;
    let closestOffset = -Infinity;
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
    }
    return closest;
  }

  // 정렬 적용: 같은 기준 재클릭이면 방향 토글, 다른 기준이면 오름차순으로 시작
  async function applySort(key) {
    if (key !== 'title' && key !== 'pub_date') return;
    if (sortState.key === key) sortState.dir = (sortState.dir === 'asc' ? 'desc' : 'asc');
    else { sortState.key = key; sortState.dir = 'asc'; }

    const catalog = await getCatalog();
    const byId = new Map(catalog.map(b => [String(b.isbn13), b]));
    const dir = sortState.dir === 'asc' ? 1 : -1;
    const sorted = Shelf.list().sort((x, y) => {
      const bx = byId.get(String(x)) || {};
      const by = byId.get(String(y)) || {};
      if (key === 'title') {
        return String(bx.title || '').localeCompare(String(by.title || ''), 'ko') * dir;
      }
      // 출간일: 빈 값은 방향과 무관하게 항상 뒤로
      const dx = bx.pub_date || '', dy = by.pub_date || '';
      if (!dx && !dy) return 0;
      if (!dx) return 1;
      if (!dy) return -1;
      return (dx < dy ? -1 : (dx > dy ? 1 : 0)) * dir;
    });
    Shelf.reorder(sorted);      // shelf:change → 본문 재렌더
    updateSortButtons();
  }

  function updateSortButtons() {
    if (!panel) return;
    panel.querySelectorAll('.shelf-sort').forEach(btn => {
      const k = btn.getAttribute('data-sort');
      const base = k === 'title' ? '가나다순' : '출간일순';
      if (sortState.key === k) {
        btn.setAttribute('aria-pressed', 'true');
        btn.textContent = base + (sortState.dir === 'asc' ? ' ↑' : ' ↓');
      } else {
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = base;
      }
    });
  }

  function boot() {
    // 런처(우상단 고정) + 권수 배지
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'shelf-launcher';
    launcher.setAttribute('aria-label', '보관함 열기');
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 4h11a1 1 0 0 1 1 1v15l-6.5-4L5 20V5a1 1 0 0 1 1-1z"/></svg>' +
      '<span class="shelf-badge" hidden>0</span>';
    launcher.addEventListener('click', openPanel);
    document.body.appendChild(launcher);

    // 딤 배경
    backdrop = document.createElement('div');
    backdrop.className = 'shelf-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);

    // 패널
    panel = document.createElement('aside');
    panel.className = 'shelf-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '보관함');
    panel.innerHTML =
      '<div class="shelf-panel-head">' +
        '<h2 class="shelf-panel-title">보관함 <span class="shelf-panel-count"></span></h2>' +
        '<button type="button" class="shelf-close" aria-label="보관함 닫기">&times;</button>' +
      '</div>' +
      '<div class="shelf-panel-tools" hidden>' +
        '<span class="shelf-tools-label">정렬</span>' +
        '<button type="button" class="shelf-sort" data-sort="title" aria-pressed="false">가나다순</button>' +
        '<button type="button" class="shelf-sort" data-sort="pub_date" aria-pressed="false">출간일순</button>' +
      '</div>' +
      '<div class="shelf-panel-body"></div>' +
      '<div class="shelf-panel-foot">' +
        '<div class="shelf-export">' +
          '<button type="button" class="shelf-btn shelf-export-xlsx">엑셀로 내보내기</button>' +
          '<button type="button" class="shelf-btn shelf-export-pdf">PDF로 내보내기</button>' +
        '</div>' +
        '<button type="button" class="shelf-btn shelf-clear">전체 비우기</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('.shelf-close').addEventListener('click', closePanel);
    panel.querySelector('.shelf-clear').addEventListener('click', () => {
      if (!Shelf.count()) return;
      if (confirm('보관함을 전부 비울까요?')) Shelf.clear();
    });
    panel.querySelector('.shelf-export-xlsx').addEventListener('click', () => exportShelf('xlsx'));
    panel.querySelector('.shelf-export-pdf').addEventListener('click', () => exportShelf('pdf'));

    // 정렬 버튼: 같은 기준 재클릭 시 오름차순↔내림차순 토글
    panel.querySelector('.shelf-panel-tools').addEventListener('click', e => {
      const btn = e.target.closest('.shelf-sort');
      if (btn) applySort(btn.getAttribute('data-sort'));
    });

    // 항목 제거는 이벤트 위임(내용 재렌더에도 유지)
    const body = panel.querySelector('.shelf-panel-body');
    body.addEventListener('click', e => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      e.preventDefault();
      e.stopPropagation();
      Shelf.remove(rm.getAttribute('data-remove'));
    });

    // 드래그로 순서 바꾸기 (HTML5 DnD, 위임)
    body.addEventListener('dragstart', e => {
      const item = e.target.closest('.shelf-item');
      if (!item) return;
      dragEl = item;
      item.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.getAttribute('data-isbn') || '');
      } catch (_) {}
    });
    body.addEventListener('dragover', e => {
      if (!dragEl) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const after = dragAfterElement(body, e.clientY);
      if (after == null) body.appendChild(dragEl);
      else if (after !== dragEl) body.insertBefore(dragEl, after);
    });
    body.addEventListener('drop', e => { if (dragEl) e.preventDefault(); });
    body.addEventListener('dragend', () => {
      if (!dragEl) return;
      dragEl.classList.remove('dragging');
      dragEl = null;
      const ids = Array.from(body.querySelectorAll('.shelf-item'))
        .map(el => el.getAttribute('data-isbn'));
      // 수동 재배치 → 정렬 표시 해제 후 반영
      if (Shelf.reorder(ids)) { sortState.key = null; }
      else { renderPanelBody(); }  // 순서 불변이면 DOM만 원복
    });

    updateBadge();

    document.addEventListener('shelf:change', () => {
      updateBadge();
      if (panel && !panel.hidden) renderPanelBody();
    });
  }

  function updateBadge() {
    if (!launcher) return;
    const badge = launcher.querySelector('.shelf-badge');
    if (!badge) return;
    const n = Shelf.count();
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  function onEsc(e) { if (e.key === 'Escape') closePanel(); }

  function openPanel() {
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      panel.classList.add('show');
    });
    document.addEventListener('keydown', onEsc);
    renderPanelBody();
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    backdrop.classList.remove('show');
    panel.classList.remove('show');
    document.removeEventListener('keydown', onEsc);
    setTimeout(() => {
      if (panel && !panel.classList.contains('show')) { panel.hidden = true; backdrop.hidden = true; }
    }, 200);
  }

  function updateFootState(hasItems) {
    if (!panel) return;
    panel.querySelectorAll('.shelf-export-xlsx, .shelf-export-pdf, .shelf-clear')
      .forEach(b => { b.disabled = !hasItems; });
  }

  async function renderPanelBody() {
    if (!panel || panel.hidden) return;
    const body = panel.querySelector('.shelf-panel-body');
    const countEl = panel.querySelector('.shelf-panel-count');

    const catalog = await getCatalog();
    if (!panel || panel.hidden) return;  // 대기 중 닫혔으면 중단

    const byId = new Map(catalog.map(b => [String(b.isbn13), b]));
    const items = [];
    const missing = [];
    Shelf.list().forEach(id => {
      const b = byId.get(String(id));
      if (b) items.push(b); else missing.push(id);
    });
    if (missing.length) prune(missing);  // 없는 id 정리 → shelf:change 재렌더

    countEl.textContent = items.length ? `(${items.length})` : '';
    updateFootState(items.length > 0);

    const tools = panel.querySelector('.shelf-panel-tools');
    if (tools) tools.hidden = items.length < 2;  // 1권 이하면 정렬 무의미
    updateSortButtons();

    if (!items.length) {
      body.innerHTML =
        '<div class="shelf-empty">보관함이 비어 있습니다.<br>' +
        '표지의 + 버튼으로 책을 담아보세요.</div>';
      return;
    }

    body.innerHTML = items.map(b => {
      const cls = [b.department, b.category].filter(Boolean).join(' · ');
      return '' +
        `<div class="shelf-item" data-isbn="${esc(b.isbn13)}" draggable="true">` +
          '<span class="shelf-item-grip" aria-hidden="true" title="드래그해서 순서 바꾸기">⠿</span>' +
          `<a class="shelf-item-link" href="book.html?isbn=${esc(b.isbn13)}" draggable="false">` +
            `<img class="shelf-item-cover" src="${esc(b.cover_url || '')}" alt="" loading="lazy" ` +
                 `draggable="false" onerror="this.onerror=null;this.src=window.PLACEHOLDER">` +
            '<span class="shelf-item-meta">' +
              `<span class="shelf-item-title">${esc(b.title || '')}</span>` +
              `<span class="shelf-item-author">${esc(b.author || '')}</span>` +
              (cls ? `<span class="shelf-item-class">${esc(cls)}</span>` : '') +
            '</span>' +
          '</a>' +
          `<button type="button" class="shelf-item-remove" data-remove="${esc(b.isbn13)}" ` +
                  'aria-label="보관함에서 제거">&times;</button>' +
        '</div>';
    }).join('');
  }

  // ── 내보내기 (담긴 순서 유지, 서버가 max=50 검증) ──
  async function exportShelf(format) {
    const isbns = Shelf.list();
    if (!isbns.length) return;
    const btns = panel ? panel.querySelectorAll('.shelf-export-xlsx, .shelf-export-pdf') : [];
    btns.forEach(b => (b.disabled = true));
    try {
      const base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE != null) ? CONFIG.API_BASE : '';
      const resp = await fetch(`${base}/api/export/books?format=${format}&max=50`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns }),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `사회평론_보관함_${today}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('내려받기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      btns.forEach(b => (b.disabled = false));
      updateFootState(Shelf.count() > 0);
    }
  }

  // ── 부팅 ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
