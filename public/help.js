'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 이용 안내 (도움말)
//  - 모든 화면 우상단에 "?" 런처 주입 → 클릭 시 중앙 모달 팝업
//  - 일반 검색 / AI 검색 / 보관함 / 내보내기 4개 항목 설명
//  - 순수 프런트(외부 의존 없음). shelf.js 와 동일하게 util.js 뒤에서 로드된다.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  let launcher, backdrop, modal;

  const SECTIONS = [
    {
      icon: '🔍',
      title: '일반 검색',
      body:
        '제목·저자 키워드로 찾고, 부서·분야·시리즈·연도·재고 상태·가격으로 좁힐 수 있습니다. ' +
        '결과는 최신순·제목순·가격순으로 정렬됩니다. ' +
        '첫 화면의 <b>“어떤 책을 찾으세요?”</b> 버튼(교양·어린이·학술)으로도 바로 둘러볼 수 있습니다.',
    },
    {
      icon: '✨',
      title: 'AI 검색',
      body:
        '찾는 책을 문장으로 설명하면 AI가 뜻을 이해해 어울리는 도서를 추천합니다. ' +
        '예) <i>“국어 교육 기초서”</i>, <i>“처음 읽는 철학”</i>, <i>“아이 그림책 추천”</i>. ' +
        '검색창 위의 <b>AI 검색</b> 탭을 눌러 사용하세요.',
    },
    {
      icon: '🔖',
      title: '보관함',
      body:
        '관심 있는 책을 최대 50권까지 담아두는 임시 목록입니다. ' +
        '표지의 <b>+</b> 버튼이나 상세 페이지의 <b>‘보관함에 추가’</b>로 담고, ' +
        '우상단 <b>책갈피 아이콘</b>으로 엽니다. ' +
        '<b>가나다순·출간일순</b> 정렬과 <b>드래그</b>로 순서를 바꿀 수 있으며, ' +
        '이 브라우저에 저장되어 로그인 없이 유지됩니다.',
    },
    {
      icon: '⬇️',
      title: '내보내기',
      body:
        '검색 결과 목록은 결과 상단의 <b>‘목록 받기’ 엑셀·PDF</b> 버튼으로 내려받습니다. ' +
        '보관함에 담은 책은 보관함 패널 아래의 <b>엑셀·PDF</b> 버튼으로 담은 순서 그대로 저장됩니다.',
    },
  ];

  function boot() {
    // 우상단 "?" 런처 (보관함 런처 왼쪽)
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'help-launcher';
    launcher.setAttribute('aria-label', '이용 안내 열기');
    launcher.textContent = '?';
    launcher.addEventListener('click', open);
    document.body.appendChild(launcher);

    // 딤 배경
    backdrop = document.createElement('div');
    backdrop.className = 'help-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);

    // 모달
    modal = document.createElement('div');
    modal.className = 'help-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '이용 안내');
    modal.innerHTML =
      '<div class="help-head">' +
        '<h2 class="help-title">이용 안내</h2>' +
        '<button type="button" class="help-close" aria-label="이용 안내 닫기">&times;</button>' +
      '</div>' +
      '<div class="help-body">' +
        SECTIONS.map(s =>
          '<section class="help-sec">' +
            `<span class="help-sec-icon" aria-hidden="true">${s.icon}</span>` +
            '<div class="help-sec-text">' +
              `<h3 class="help-sec-title">${s.title}</h3>` +
              `<p class="help-sec-body">${s.body}</p>` +
            '</div>' +
          '</section>'
        ).join('') +
      '</div>';
    document.body.appendChild(modal);

    modal.querySelector('.help-close').addEventListener('click', close);
  }

  function onEsc(e) { if (e.key === 'Escape') close(); }

  function open() {
    backdrop.hidden = false;
    modal.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      modal.classList.add('show');
    });
    document.addEventListener('keydown', onEsc);
    const closeBtn = modal.querySelector('.help-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!modal || modal.hidden) return;
    backdrop.classList.remove('show');
    modal.classList.remove('show');
    document.removeEventListener('keydown', onEsc);
    setTimeout(() => {
      if (modal && !modal.classList.contains('show')) { modal.hidden = true; backdrop.hidden = true; }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
