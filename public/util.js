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

window.esc = esc;
window.getViewMode = getViewMode;
window.isInternal = isInternal;
window.applyViewModeClass = applyViewModeClass;
