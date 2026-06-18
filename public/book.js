'use strict';

const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300">' +
  '<rect width="100%" height="100%" fill="#e8e8e8"/>' +
  '<text x="50%" y="50%" fill="#999" font-size="16" text-anchor="middle" dy=".3em">No Cover</text>' +
  '</svg>'
);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

function render(book) {
  const oop = book.stock_status === '절판';
  const sold = book.stock_status === '품절';
  const statusBadge = oop ? '<span class="status-badge oop">절판</span>'
    : sold ? '<span class="status-badge sold-out">품절</span>' : '';

  const links = normalizeLinks(book.store_links);
  const storeHtml = [
    links.kyobo && `<a href="${esc(links.kyobo)}" target="_blank" rel="noopener" class="btn-store">교보문고</a>`,
    links.yes24 && `<a href="${esc(links.yes24)}" target="_blank" rel="noopener" class="btn-store">YES24</a>`,
    links.aladin && `<a href="${esc(links.aladin)}" target="_blank" rel="noopener" class="btn-store">알라딘</a>`,
  ].filter(Boolean).join('');

  const rows = [
    ['출판사', book.publisher],
    ['출간일', book.pub_date],
    ['분야', [book.department, book.category].filter(Boolean).join(' › ')],
    ['시리즈', book.series],
    ['ISBN', book.isbn13],
    ['정가', book.price_standard != null ? '₩' + book.price_standard.toLocaleString() : null],
    ['판매가', book.price_sales != null ? '₩' + book.price_sales.toLocaleString() : null],
  ].filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  // 소개: 출판사 소개 → aladin 전체 소개 → 짧은 소개 순으로 우선
  const pubDesc  = book.publisher_description || '';
  const fullDesc = book.full_description || book.description || '';
  const toc = formatToc(book.toc || '');
  const attachments = Array.isArray(book.attachments) ? book.attachments : [];
  const isbn = book.isbn13;

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
        <dl>${rows}</dl>
        ${pubDesc  ? `<div class="description"><h3>출판사 서평</h3>${formatDesc(pubDesc)}</div>`  : ''}
        ${fullDesc ? `<div class="description"><h3>책 소개</h3>${formatDesc(fullDesc)}</div>` : ''}
        ${toc      ? `<div class="description"><h3>목차</h3>${toc}</div>` : ''}
        ${attachHtml}
      </div>
    </article>`;
}

function formatDesc(text) {
  if (!text) return '';
  return text.split(/\n\n+/)
    .map(p => `<p>${esc(p.replace(/\n/g, ' ').trim())}</p>`)
    .join('');
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
loadBook();
