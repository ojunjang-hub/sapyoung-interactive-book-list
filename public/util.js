'use strict';

// 공통 HTML 이스케이프 유틸 (main.js / book.js / admin.js 공유)
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 공개(public) / 내부(internal) 뷰 모드 ──
// 외부 배포 기본값은 반드시 public. 내부 전환은 URL ?mode=internal 로 하며,
// 페이지 이동(book.html 등) 간 유지를 위해 localStorage에 저장한다.
// 다시 public으로: ?mode=public
function getViewMode() {
  let stored = 'public';
  try { stored = localStorage.getItem('view_mode') || 'public'; } catch (_) {}
  const param = new URLSearchParams(location.search).get('mode');
  if (param === 'internal' || param === 'public') {
    stored = param;
    try { localStorage.setItem('view_mode', param); } catch (_) {}
  }
  return stored === 'internal' ? 'internal' : 'public';
}

function isInternal() {
  return getViewMode() === 'internal';
}

// <html>에 모드 클래스를 부여해 CSS로 내부 전용 요소를 숨긴다.
// (index.html <head>의 인라인 스크립트가 먼저 적용해 깜빡임을 방지하고, 여기서 동기화)
function applyViewModeClass() {
  const mode = getViewMode();
  const el = document.documentElement;
  el.classList.toggle('mode-internal', mode === 'internal');
  el.classList.toggle('mode-public', mode !== 'internal');
}

// ── 리치 텍스트 새니타이저 ──
// 관리자가 입력한 서식 HTML을 화이트리스트로 정제(상세 페이지가 공개되므로 XSS 차단).
// 저장 직전과 렌더 시 양쪽에서 호출한다.
const _RT_TAGS = new Set(['P', 'DIV', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM',
  'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
const _RT_STYLE_PROPS = new Set(['text-align', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'margin-left', 'padding-left',
  'text-indent']);
const _RT_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED',
  'LINK', 'META', 'NOSCRIPT']);

function looksLikeHtml(s) {
  return /<(\/?)(p|div|br|span|b|strong|i|em|u|s|ul|ol|li|blockquote)\b[^>]*>/i
    .test(String(s == null ? '' : s));
}

function _rtSafeStyle(style) {
  const out = [];
  String(style).split(';').forEach(decl => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (_RT_STYLE_PROPS.has(prop) && !/url\(|expression|javascript:|[<>]/i.test(val)) {
      out.push(prop + ': ' + val);
    }
  });
  return out.join('; ');
}

function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(
    '<div id="__rt">' + String(html) + '</div>', 'text/html');
  const root = doc.getElementById('__rt');

  (function clean(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 1) {
        const tag = child.tagName.toUpperCase();
        if (_RT_DROP.has(tag)) { child.remove(); return; }
        clean(child);  // 자식 먼저 정제
        if (!_RT_TAGS.has(tag)) {
          // 허용되지 않은 태그는 내용만 남기고 벗겨낸다(unwrap)
          const parent = child.parentNode;
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          parent.removeChild(child);
          return;
        }
        Array.from(child.attributes).forEach(attr => {
          if (attr.name.toLowerCase() === 'style') {
            const safe = _rtSafeStyle(attr.value);
            if (safe) child.setAttribute('style', safe);
            else child.removeAttribute('style');
          } else {
            child.removeAttribute(attr.name);  // on*, href, class 등 전부 제거
          }
        });
      } else if (child.nodeType === 8) {
        child.remove();  // 주석 제거
      }
    });
  })(root);

  return root.innerHTML;
}

window.esc = esc;
window.getViewMode = getViewMode;
window.isInternal = isInternal;
window.applyViewModeClass = applyViewModeClass;
window.sanitizeHtml = sanitizeHtml;
window.looksLikeHtml = looksLikeHtml;
