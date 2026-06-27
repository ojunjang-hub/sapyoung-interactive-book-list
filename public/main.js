'use strict';

const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="225">' +
  '<rect width="100%" height="100%" fill="#e8e8e8"/>' +
  '<text x="50%" y="50%" fill="#999" font-size="14" text-anchor="middle" dy=".3em">No Cover</text>' +
  '</svg>'
);

let allBooks = [];

// esc()는 util.js에서 전역 제공

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  applyViewModeClass();  // 공개/내부 뷰 모드 (기본 public)

  // 데이터 로드 — 실패해도 UI는 계속 동작
  try {
    const resp = await fetch(`${CONFIG.API_BASE}/api/books?size=2000`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    allBooks = Array.isArray(data) ? data : (data.items || []);
  } catch (_) {
    try {
      const resp = await fetch('data/books.json');
      if (!resp.ok) throw new Error('json');
      const raw = await resp.json();
      allBooks = Array.isArray(raw) ? raw : (raw.items || []);
    } catch (_2) {
      allBooks = [];
    }
  }

  const countEl = document.getElementById('total-count');
  if (countEl) {
    countEl.textContent = allBooks.length
      ? `전체 ${allBooks.length.toLocaleString()}권`
      : '전체 목록';
  }

  buildFilters();
  bindEvents();
  setSearchMode('normal');  // 기본 검색 모드 = 일반 (배지·예시칩 숨김)
  loadNewBooks();

  // 뒤로가기 라우팅: 현재 URL/history.state로 화면 복원
  history.scrollRestoration = 'manual';
  applyState(history.state || null);
  replaceNav();  // 초기 항목에 state 기록
}

// ─── 라우팅 / 히스토리 (뒤로가기 지원) ─────────────────────────────────────────

let restoring = false;  // 복원 중에는 pushState를 막아 루프 방지

const FILTER_IDS = {
  q: 'search', department: 'filter-department', category: 'filter-category',
  series: 'filter-series', year: 'filter-year', stock: 'filter-stock',
  priceMin: 'price-min', priceMax: 'price-max', sort: 'sort',
};

function currentView() {
  const grid = document.getElementById('grid-view');
  return grid && grid.style.display !== 'none' ? 'grid' : 'landing';
}

function collectState(view) {
  const s = { view: view || currentView(), scrollY: window.scrollY };
  for (const [k, id] of Object.entries(FILTER_IDS)) {
    const el = document.getElementById(id);
    if (el && el.value) s[k] = el.value;
  }
  return s;
}

function stateToUrl(s) {
  const p = new URLSearchParams();
  if (s.view === 'grid') p.set('view', 'grid');
  for (const k of Object.keys(FILTER_IDS)) if (s[k]) p.set(k, s[k]);
  // 내부 모드 플래그는 URL에 유지(공유/새로고침 시)
  if (isInternal()) p.set('mode', 'internal');
  const qs = p.toString();
  return location.pathname + (qs ? '?' + qs : '');
}

function pushNav(view) {
  if (restoring) return;
  const s = collectState(view);
  history.pushState(s, '', stateToUrl(s));
}

function replaceNav(view) {
  const s = collectState(view);
  history.replaceState(s, '', stateToUrl(s));
}

function applyState(s) {
  if (!s || !s.view) {
    const p = new URLSearchParams(location.search);
    s = Object.assign({}, s, { view: p.get('view') === 'grid' ? 'grid' : 'landing' });
    for (const k of Object.keys(FILTER_IDS)) { const v = p.get(k); if (v) s[k] = v; }
  }
  restoring = true;
  try {
    const setVal = (k, v) => { const el = document.getElementById(FILTER_IDS[k]); if (el) el.value = v || ''; };
    setVal('department', s.department);
    updateCategoryOptions(s.department || '');
    ['q', 'category', 'series', 'year', 'stock', 'priceMin', 'priceMax', 'sort']
      .forEach(k => setVal(k, s[k]));

    if (s.view === 'grid') {
      document.getElementById('landing').style.display = 'none';
      document.getElementById('grid-view').style.display = '';
      document.getElementById('ai-result-panel').style.display = 'none';
      document.getElementById('ai-status').style.display = 'none';
      document.getElementById('normal-search').style.display = '';
      const dept = s.department || '', cat = s.category || '';
      document.getElementById('grid-view-title').textContent =
        [dept, cat].filter(Boolean).join(' · ') || '전체 목록';
      render();
    } else {
      document.getElementById('grid-view').style.display = 'none';
      document.getElementById('landing').style.display = '';
    }
  } finally {
    restoring = false;
  }
  const y = (s && typeof s.scrollY === 'number') ? s.scrollY : 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

window.addEventListener('popstate', e => applyState(e.state || null));

// ─── View switching ───────────────────────────────────────────────────────────

function showGrid(preFilters) {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('grid-view').style.display = '';
  document.getElementById('ai-result-panel').style.display = 'none';
  document.getElementById('ai-status').style.display = 'none';
  document.getElementById('normal-search').style.display = '';

  const dept = (preFilters && preFilters.department) || '';
  const cat  = (preFilters && preFilters.category)   || '';
  const q    = (preFilters && preFilters.q)          || '';

  if (dept) {
    document.getElementById('filter-department').value = dept;
    updateCategoryOptions(dept);
  }
  if (cat) document.getElementById('filter-category').value = cat;
  if (q)   document.getElementById('search').value = q;

  const titleEl = document.getElementById('grid-view-title');
  titleEl.textContent = [dept, cat].filter(Boolean).join(' · ') || '전체 목록';

  render();
  pushNav('grid');  // 히스토리 항목 추가 (뒤로가기 대상)
}

function showLanding() {
  document.getElementById('grid-view').style.display = 'none';
  document.getElementById('landing').style.display = '';

  // Reset grid state
  document.querySelectorAll('.toolbar select').forEach(el => (el.selectedIndex = 0));
  document.querySelectorAll('.toolbar input').forEach(el => (el.value = ''));
  buildFilters();

  // Reset finder
  resetFinder();

  // Clear AI input
  document.getElementById('ai-input').value = '';
  pushNav('landing');  // 히스토리 항목 추가
}

function showNormalSearch() {
  document.getElementById('ai-result-panel').style.display = 'none';
  document.getElementById('normal-search').style.display = '';
  document.getElementById('grid-view-title').textContent = '전체 목록';
  render();
}

// ─── Finder (Section 1) ───────────────────────────────────────────────────────

const DEPT_LABEL = { '교양': '나를 위한 책', '어린이': '아이와 함께', '대학교재·학술': '공부·연구용' };

function initFinder() {
  document.querySelectorAll('.finder-btn[data-dept]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dept = btn.dataset.dept;
      showFinderStep2(dept);
    });
  });
  document.getElementById('finder-back').addEventListener('click', resetFinder);

  // 분야 버튼은 동적으로 생성되므로 컨테이너에 이벤트 위임
  document.getElementById('finder-categories').addEventListener('click', e => {
    const btn = e.target.closest('.finder-cat-btn');
    if (!btn) return;
    const dept = btn.dataset.dept;
    const cat = btn.dataset.cat;
    showGrid(cat ? { department: dept, category: cat } : { department: dept });
  });
}

function showFinderStep2(dept) {
  document.getElementById('finder-step1').style.display = 'none';
  const step2 = document.getElementById('finder-step2');
  step2.style.display = '';
  document.getElementById('finder-hint').textContent =
    `${DEPT_LABEL[dept] || dept} 중 분야를 선택하세요`;

  const cats = [...new Set(
    allBooks.filter(b => b.department === dept && b.category).map(b => b.category)
  )].sort((a, b) => a.localeCompare(b, 'ko'));

  const container = document.getElementById('finder-categories');

  if (!cats.length) {
    showGrid({ department: dept });
    return;
  }

  const allBtn =
    `<button class="finder-cat-btn finder-cat-all" data-dept="${esc(dept)}">전체 보기</button>`;
  container.innerHTML = allBtn + cats.map(cat =>
    `<button class="finder-cat-btn" data-dept="${esc(dept)}" data-cat="${esc(cat)}">${esc(cat)}</button>`
  ).join('');
}

function resetFinder() {
  document.getElementById('finder-step1').style.display = '';
  document.getElementById('finder-step2').style.display = 'none';
  document.getElementById('finder-categories').innerHTML = '';
}

// ─── New books strip (Section 3) ──────────────────────────────────────────────

function loadNewBooks() {
  const strip = document.getElementById('newbooks-strip');
  if (!strip) return;

  // 표지 있는 신간을 우선 채우고(표지 없음은 후순위), 같은 그룹 안에서 최신순
  const newBooks = [...allBooks]
    .filter(b => b.pub_date && b.stock_status !== '절판')
    .sort((a, b) => {
      const ca = hasCover(a), cb = hasCover(b);
      if (ca !== cb) return ca ? -1 : 1;
      return (b.pub_date || '').localeCompare(a.pub_date || '');
    })
    .slice(0, 12);

  if (!newBooks.length) {
    strip.innerHTML = '<div class="newbooks-loading">신간 정보가 없습니다.</div>';
    return;
  }

  strip.innerHTML = newBooks.map(b => `
    <a class="newbook-card" href="book.html?isbn=${esc(b.isbn13)}">
      <div class="newbook-cover">
        <img src="${esc(b.cover_url || '')}" alt="${esc(b.title)}" loading="lazy"
             onerror="this.onerror=null;this.src=window.PLACEHOLDER">
      </div>
      <p class="newbook-title">${esc(b.title)}</p>
    </a>
  `).join('');

  setupNewbooksNav(strip);
}

// '새로 나온 책' 가로 스트립의 좌우 이동 버튼. 한 번에 보이는 영역의 80%만큼
// 부드럽게 스크롤하고, 양 끝에서는 해당 버튼을 숨긴다.
function setupNewbooksNav(strip) {
  const prev = document.getElementById('newbooks-prev');
  const next = document.getElementById('newbooks-next');
  if (!prev || !next) return;

  const pageBy = () => Math.max(240, Math.round(strip.clientWidth * 0.8));
  const update = () => {
    const maxLeft = strip.scrollWidth - strip.clientWidth - 1;
    const scrollable = maxLeft > 0;
    prev.classList.toggle('hidden', !scrollable || strip.scrollLeft <= 0);
    next.classList.toggle('hidden', !scrollable || strip.scrollLeft >= maxLeft);
  };

  prev.onclick = () => strip.scrollBy({ left: -pageBy(), behavior: 'smooth' });
  next.onclick = () => strip.scrollBy({ left: pageBy(), behavior: 'smooth' });
  strip.onscroll = update;
  if (!setupNewbooksNav._resizeBound) {
    window.addEventListener('resize', () => update());
    setupNewbooksNav._resizeBound = true;
  }
  update();
}

// ─── Filters ──────────────────────────────────────────────────────────────────

// 주요 시리즈 그룹: label → 책이 해당 그룹인지 판별하는 함수
const SERIES_GROUPS = [
  { label: '용선생 계열',          match: b => (b.series || '').startsWith('용선생') },
  { label: '교양으로 읽는 용선생 세계사', match: b => (b.series || '').startsWith('교양으로 읽는 용선생') },
  { label: '그램그램',             match: b => (b.series || '').startsWith('그램그램') },
  { label: '난처한 시리즈',         match: b => (b.series || '').startsWith('난처한') || (b.category || '') === '난처한 시리즈' },
  { label: '반헌법행위자열전',       match: b => (b.series || '').startsWith('반헌법') || (b.title || '').includes('반헌법행위자열전') },
  { label: '화정미술사강연',         match: b => (b.series || '').startsWith('화정미술사') },
  { label: '전태일문학상 수상작품집', match: b => (b.title || '').includes('전태일문학상') || (b.title || '').includes('전태일 문학상') },
  { label: '서울대 국제문제연구소 총서', match: b => (b.series || '').startsWith('서울대학교 국제문제연구소') },
  { label: '김영민 논어 연작',       match: b => (b.series || '').startsWith('김영민 논어') },
  { label: '화정미술사 총서',        match: b => (b.series || '').startsWith('화정미술사') },
];

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function buildFilters() {
  fillSelect('filter-department', uniqSorted(allBooks.map(b => b.department)));
  fillSelect('filter-category',   uniqSorted(allBooks.map(b => b.category)));
  fillSeriesSelect();
  const years = uniqSorted(allBooks.map(b => (b.pub_date || '').slice(0, 4))).sort().reverse();
  fillSelect('filter-year', years);
  const statuses = uniqSorted(allBooks.map(b => b.stock_status));
  fillSelect('filter-stock', statuses);
}

function fillSeriesSelect() {
  const sel = document.getElementById('filter-series');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  // 실제 데이터에 해당 책이 있는 그룹만 표시
  SERIES_GROUPS.forEach(g => {
    if (allBooks.some(g.match)) {
      const o = document.createElement('option');
      o.value = g.label;
      o.textContent = `${g.label} (${allBooks.filter(g.match).length}권)`;
      sel.appendChild(o);
    }
  });
}

function fillSelect(id, options) {
  const sel = document.getElementById(id);
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
}

function updateCategoryOptions(dept) {
  const cats = uniqSorted(
    allBooks.filter(b => !dept || b.department === dept).map(b => b.category)
  );
  fillSelect('filter-category', cats);
}

function getFilters() {
  return {
    q:          document.getElementById('search').value.trim(),
    department: document.getElementById('filter-department').value,
    category:   document.getElementById('filter-category').value,
    series:     document.getElementById('filter-series').value,
    year:       document.getElementById('filter-year').value,
    stock:      document.getElementById('filter-stock').value,
    priceMin:   document.getElementById('price-min').value,
    priceMax:   document.getElementById('price-max').value,
    sort:       document.getElementById('sort').value,
  };
}

function applyFilters(books, f) {
  return books.filter(b => {
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!(b.title  || '').toLowerCase().includes(q) &&
          !(b.author || '').toLowerCase().includes(q)) return false;
    }
    if (f.department && b.department  !== f.department) return false;
    if (f.category   && b.category    !== f.category)   return false;
    if (f.series) {
      const group = SERIES_GROUPS.find(g => g.label === f.series);
      if (group ? !group.match(b) : b.series !== f.series) return false;
    }
    if (f.year       && !(b.pub_date  || '').startsWith(f.year)) return false;
    if (f.stock      && b.stock_status !== f.stock)     return false;
    if (f.priceMin   && (b.price_sales == null || b.price_sales < +f.priceMin)) return false;
    if (f.priceMax   && (b.price_sales == null || b.price_sales > +f.priceMax)) return false;
    return true;
  });
}

function hasCover(b) {
  return !!(b.cover_url && String(b.cover_url).trim());
}

function sortBooks(books, key) {
  return [...books].sort((a, b) => {
    // 같은 정렬 기준 안에서 '표지 있음'을 '표지 없음'보다 앞에 둔다
    const ca = hasCover(a), cb = hasCover(b);
    if (ca !== cb) return ca ? -1 : 1;
    switch (key) {
      case 'title_asc':   return (a.title || '').localeCompare(b.title || '', 'ko');
      case 'price_asc':   return (a.price_sales || 0) - (b.price_sales || 0);
      case 'price_desc':  return (b.price_sales || 0) - (a.price_sales || 0);
      case 'pub_date_desc':
      default:            return (b.pub_date || '').localeCompare(a.pub_date || '');
    }
  });
}

function render() {
  const f    = getFilters();
  const list = sortBooks(applyFilters(allBooks, f), f.sort);
  renderGrid(list);
}

function renderGrid(books) {
  const grid = document.getElementById('book-grid');
  document.getElementById('result-count').textContent = `${books.length.toLocaleString()}권`;
  if (!books.length) {
    grid.innerHTML = `<div class="empty-state">조건에 맞는 도서가 없습니다.</div>`;
    return;
  }
  grid.innerHTML = books.map(b => {
    const oop  = b.stock_status === '절판';
    const sold = b.stock_status === '품절';
    const badge = oop  ? '<span class="badge oop">절판</span>'
                : sold ? '<span class="badge sold-out">품절</span>' : '';
    const price = b.price_sales != null ? '₩' + b.price_sales.toLocaleString() : '';
    return `
      <a class="book-card${oop ? ' out-of-print' : ''}" href="book.html?isbn=${esc(b.isbn13)}">
        <div class="cover-wrap">
          <img src="${esc(b.cover_url || '')}" alt="${esc(b.title)}" loading="lazy"
               onerror="this.onerror=null;this.src=window.PLACEHOLDER">
          ${badge}
        </div>
        <div class="book-meta">
          <p class="title">${esc(b.title)}</p>
          <p class="author">${esc(b.author || '')}</p>
          <p class="price">${price}</p>
        </div>
      </a>`;
  }).join('');
}

// ─── 검색 모드 (일반 / AI) ────────────────────────────────────────────────────

let searchMode = 'normal';  // 기본: 일반 검색

function setSearchMode(mode) {
  searchMode = (mode === 'ai') ? 'ai' : 'normal';
  const isAi = searchMode === 'ai';
  document.getElementById('mode-normal').classList.toggle('active', !isAi);
  document.getElementById('mode-ai').classList.toggle('active', isAi);
  const label = document.getElementById('ai-label');
  const chips = document.getElementById('ai-chips');
  if (label) label.style.display = isAi ? '' : 'none';
  if (chips) chips.style.display = isAi ? '' : 'none';
  const input = document.getElementById('ai-input');
  if (input) {
    input.placeholder = isAi
      ? '어떤 책을 찾고 계세요? 예: 처음 읽는 철학, 아이 그림책 추천'
      : '제목 · 저자로 검색';
  }
}

function submitLandingSearch() {
  if (searchMode === 'ai') {
    runAiSearch();
    return;
  }
  // 일반 검색: 기존 목록 필터의 검색 로직(applyFilters의 q) 재사용
  const text = document.getElementById('ai-input').value.trim();
  showGrid({ q: text });
}

// ─── AI 자연어 검색 ──────────────────────────────────────────────────────────

function setAiQuery(text) {
  // 예시 칩 클릭 시 AI 모드로 전환 후 검색
  setSearchMode('ai');
  document.getElementById('ai-input').value = text;
  runAiSearch();
}

async function runAiSearch() {
  const query = document.getElementById('ai-input').value.trim();
  if (!query) return;

  // Switch to grid view
  document.getElementById('landing').style.display = 'none';
  document.getElementById('grid-view').style.display = '';
  document.getElementById('normal-search').style.display = 'none';
  document.getElementById('ai-result-panel').style.display = 'none';

  const status    = document.getElementById('ai-status');
  const panel     = document.getElementById('ai-result-panel');
  const aiGrid    = document.getElementById('ai-grid');
  const aiSummary = document.getElementById('ai-summary');

  document.getElementById('grid-view-title').textContent = `AI 검색: ${query}`;
  status.style.display = 'flex';
  aiGrid.innerHTML = '';

  try {
    const resp = await fetch(`${CONFIG.API_BASE}/api/search/natural`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    status.style.display = 'none';

    if (!data.books || !data.books.length) {
      aiSummary.textContent = '적합한 도서를 찾지 못했습니다. 다른 표현으로 검색해보세요.';
      panel.style.display = 'block';
      return;
    }

    aiSummary.textContent = data.summary || '';
    aiGrid.innerHTML = data.books.map(b => {
      const oop  = b.stock_status === '절판';
      const sold = b.stock_status === '품절';
      const badge = oop  ? '<span class="badge oop">절판</span>'
                  : sold ? '<span class="badge sold-out">품절</span>' : '';
      const price = b.price_sales != null ? '₩' + b.price_sales.toLocaleString() : '';
      return `
        <a class="book-card${oop ? ' out-of-print' : ''}" href="book.html?isbn=${esc(b.isbn13)}">
          <div class="cover-wrap">
            <img src="${esc(b.cover_url || '')}" alt="${esc(b.title)}" loading="lazy"
                 onerror="this.onerror=null;this.src=window.PLACEHOLDER">
            ${badge}
          </div>
          <div class="book-meta">
            <p class="title">${esc(b.title)}</p>
            <p class="author">${esc(b.author || '')}</p>
            <p class="price">${price}</p>
            ${b.ai_reason ? `<p class="ai-reason">${esc(b.ai_reason)}</p>` : ''}
          </div>
        </a>`;
    }).join('');

    panel.style.display = 'block';

  } catch (e) {
    status.style.display = 'none';
    aiSummary.textContent = `검색 오류: ${e.message}`;
    panel.style.display = 'block';
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────

// 필터 변경 시: 렌더 후 히스토리 항목 추가(뒤로가기로 직전 필터 상태 복원)
function renderAndPush() {
  render();
  pushNav('grid');
}

function bindEvents() {
  document.getElementById('btn-all-books').addEventListener('click', e => {
    e.preventDefault();
    showGrid({});
  });
  document.getElementById('btn-back-landing').addEventListener('click', showLanding);

  initFinder();

  let t;
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(renderAndPush, 250);
  });

  document.getElementById('filter-department').addEventListener('change', () => {
    const dept = document.getElementById('filter-department').value;
    document.getElementById('filter-category').selectedIndex = 0;
    updateCategoryOptions(dept);
    renderAndPush();
  });

  ['filter-category', 'filter-series', 'filter-year', 'filter-stock', 'sort']
    .forEach(id => document.getElementById(id).addEventListener('change', renderAndPush));

  ['price-min', 'price-max'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(renderAndPush, 350);
    });
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    document.querySelectorAll('.toolbar input').forEach(el => (el.value = ''));
    document.querySelectorAll('.toolbar select').forEach(el => (el.selectedIndex = 0));
    buildFilters();
    renderAndPush();
  });

  // 상세(book.html)로 이동하기 직전, 현재 스크롤 위치를 history.state에 저장
  // → 뒤로가기로 돌아왔을 때 목록 스크롤 위치 복원
  document.addEventListener('click', e => {
    const card = e.target.closest('a.book-card, a.newbook-card');
    if (card) replaceNav();
  }, true);
}

window.PLACEHOLDER = PLACEHOLDER;

init();
