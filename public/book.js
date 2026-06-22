'use strict';

const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300">' +
  '<rect width="100%" height="100%" fill="#e8e8e8"/>' +
  '<text x="50%" y="50%" fill="#999" font-size="16" text-anchor="middle" dy=".3em">No Cover</text>' +
  '</svg>'
);

// esc()는 util.js에서 전역 제공

async function loadBook() {
  const isbn = new URLSearchParams(location.search).get('isbn');
  const root = document.getElementById('detail-root');
  if (!isbn) {
    root.innerHTML = `<div class="error-state">잘못된 접근입니다.</div>`;
    return;
  }

  let book = null;
  // 1. API 우선 시도
  try {
    const resp = await fetch(`${CONFIG.API_BASE}/api/books/${encodeURIComponent(isbn)}`);
    if (resp.ok) book = await resp.json();
  } catch (e) { /* API 미가동 → 폴백 */ }

  // 2. 폴백: 정적 JSON에서 찾기
  if (!book) {
    try {
      const resp = await fetch('data/books.json');
      const list = await resp.json();
      book = list.find(b => String(b.isbn13) === String(isbn)) || null;
    } catch (e) { /* ignore */ }
  }

  if (!book) {
    root.innerHTML = `<div class="error-state">도서를 찾을 수 없습니다.
      <br><a class="btn-store" href="index.html">목록으로</a></div>`;
    return;
  }
  document.title = `${book.title} — 사회평론 도서목록`;
  render(book);
}

// 값이 비어 있으면(null/빈문자열/빈배열) 해당 항목 자체를 표시하지 않는다.
function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function render(book) {
  const oop = book.stock_status === '절판';
  const sold = book.stock_status === '품절';
  const statusBadge = oop ? '<span class="status-badge oop">절판</span>'
    : sold ? '<span class="status-badge sold-out">품절</span>' : '';

  // 서점 링크는 ISBN 기반 정상 URL로 직접 생성(교보/예스24의 기존 저장값이 오작동).
  // 알라딘은 보강 시 받은 실제 상품 링크가 있으면 우선 사용.
  const isbn = book.isbn13;
  const stored = normalizeLinks(book.store_links);
  const storeUrls = [
    ['교보문고', `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(isbn)}`],
    ['YES24',   `https://www.yes24.com/product/search?query=${encodeURIComponent(isbn)}`],
    ['알라딘',  stored.aladin || `https://www.aladin.co.kr/shop/wproduct.aspx?ISBN=${encodeURIComponent(isbn)}`],
  ];
  const storeHtml = isbn ? storeUrls
    .map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener" class="btn-store">${esc(label)}</a>`)
    .join('') : '';

  const won = n => '₩' + Number(n).toLocaleString();

  // ── 서지/스펙 행 (값 없으면 라벨까지 함께 제외) ──
  // 판매지수는 내부(internal) 뷰에서만 노출
  const rows = [
    ['출판사', book.publisher],
    ['출간일', book.pub_date],
    ['분야', [book.department, book.category].filter(Boolean).join(' › ')],
    ['시리즈', book.series],
    ['쪽수', hasValue(book.pages) ? `${book.pages}쪽` : null],
    ['ISBN', book.isbn13],
    ['정가', book.price_standard != null ? won(book.price_standard) : null],
    ['재고 상태', book.stock_status],
    (isInternal() && book.sales_point != null)
      ? ['알라딘 판매지수', Number(book.sales_point).toLocaleString()] : null,
  ].filter(Boolean)
    .filter(([, v]) => hasValue(v))
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  // ── 긴 내용 블록 (값 없으면 제목까지 함께 제외) ──
  // 관리자가 서식(HTML)을 넣은 필드는 정제 후 그대로, 평문은 줄바꿈 처리
  const sections = [
    ['책 소개', renderRich(book.full_description || book.description || '')],
    ['저자 소개', renderRich(book.author_intro || '')],
    ['출판사 서평', renderRich(book.publisher_description || '')],
    ['추천사', renderRich(book.endorsements || '')],
    ['인상적인 구절', formatQuotes(book.quotable_phrases)],
    ['목차', formatToc(book.toc || '')],
  ].filter(([, html]) => hasValue(html))
    .map(([title, html]) => `<div class="description"><h3>${esc(title)}</h3>${html}</div>`)
    .join('');

  const attachments = Array.isArray(book.attachments) ? book.attachments : [];

  const attachHtml = attachments.length ? `
    <div class="attachments">
      <h3>자료 다운로드</h3>
      <ul>${attachments.map(a => `
        <li>
          <a href="${CONFIG.API_BASE}/api/books/${encodeURIComponent(isbn)}/attachments/${encodeURIComponent(a.id)}" download>
            [${esc(a.file_type || '파일')}] ${esc(a.filename || '')}${a.version ? ' v' + esc(a.version) : ''}
          </a>
          ${a.description ? `<span> — ${esc(a.description)}</span>` : ''}
        </li>`).join('')}</ul>
    </div>` : '';

  document.getElementById('detail-root').innerHTML = `
    <article class="detail">
      <div class="cover">
        <img src="${esc((book.cover_url || '').replace('cover200', 'cover500'))}" alt="${esc(book.title)}"
             onerror="this.onerror=null;this.src=window.PLACEHOLDER">
      </div>
      <div class="info">
        <h2>${esc(book.title)}${statusBadge}</h2>
        <p class="author">${esc(book.author || '')}</p>
        ${storeHtml ? `<div class="store-links">${storeHtml}</div>` : ''}
        ${rows ? `<dl>${rows}</dl>` : ''}
        ${sections}
        ${attachHtml}
      </div>
    </article>`;
}

// 관리자 서식(HTML)이 들어온 필드는 정제 후 그대로, 아니면 평문 줄바꿈 처리(하위호환)
function renderRich(text) {
  if (!text) return '';
  if (looksLikeHtml(text)) return sanitizeHtml(text);
  return formatDesc(text);
}

// 본문 텍스트용: 빈 줄(\n\n+)로 문단 분리, 문단 내 단일 줄바꿈(\n)은 한 줄 더 띄워(<br><br>) 표시.
// DB 설명/저자소개/서평은 단일 \n으로 줄을 구분하므로 반드시 보존해야 한다.
function formatDesc(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').split(/\n\n+/)
    .map(p => p.replace(/\n+$/g, '').replace(/^\n+/g, ''))
    .filter(p => p.trim())
    .map(p => `<p>${esc(p).replace(/\n/g, '<br><br>')}</p>`)
    .join('');
}

// 인상적인 구절: 백엔드가 JSON 배열로 주면 배열, 파싱 실패 시 문자열로 들어온다
function formatQuotes(raw) {
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string') items = raw.split(/\n\n+/);
  items = items.map(q => String(q == null ? '' : q).trim()).filter(Boolean);
  if (!items.length) return '';
  return '<div class="quote-list">' +
    items.map(q => `<blockquote class="quote">${esc(q)}</blockquote>`).join('') +
    '</div>';
}

function formatToc(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';

  let html = '<div class="toc-block">';
  lines.forEach(line => {
    const mNum = /^(\d{1,3})\.\s+(.+)/.exec(line);
    if (mNum) {
      html += `<div class="toc-item"><span class="toc-num">${esc(mNum[1])}.</span><span class="toc-text">${esc(mNum[2])}</span></div>`;
      return;
    }
    if (/^(제\s*\d+\s*[장부편절]|Part\s+\d+|[IVX]+\.|[Ⅰ-Ⅹ]+)[\s.]/.test(line) ||
        /^(머리말|서문|서론|에필로그|프롤로그|후기|부록|참고문헌|저자|역자)/.test(line)) {
      html += `<div class="toc-chapter">${esc(line)}</div>`;
      return;
    }
    html += `<div class="toc-misc">${esc(line)}</div>`;
  });
  html += '</div>';
  return html;
}

function normalizeLinks(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  return raw;
}

window.PLACEHOLDER = PLACEHOLDER;
applyViewModeClass();
loadBook();
