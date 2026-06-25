"""알라딘 상품 페이지 콘텐츠 스크래핑 폴백.

ItemLookUp API가 목차·책소개·저자소개·출판사 서평을 비워서 줄 때, 상품 페이지가
내부적으로 호출하는 콘텐츠 AJAX(getContents.aspx)를 그대로 받아 추출한다.

  /shop/product/getContents.aspx?isbn={isbn}&name={Introduce|AuthorInfo|PublisherDesc}

- Introduce  → 책소개(첫 Ere_prod_mconts_R) + 목차(div#div_TOC_All)
- AuthorInfo → 저자/역자 소개(div#div_AuthorInfo_<id>_All, 복수 가능)
- PublisherDesc → 출판사 서평(div#div_PublisherDesc_All)

지시서(데이터보강_추출보정_지시서.md) 수정 B 지침 반영:
필드별 전용 컨테이너만 선택, 미리보기(_Short)+전체(_All) 중복 회피(_All만 사용),
책소개/목차 분리, 보일러플레이트 제거.
"""

import html as _html
import logging
import re

import httpx

_GETCONTENTS = "https://www.aladin.co.kr/shop/product/getContents.aspx"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# 본문에 섞여 들어오는 내비/안내 문구 — 해당 문구가 든 줄은 버린다.
_BOILERPLATE = (
    "도서 모두보기", "신간알림 신청", "신간알림 SMS", "최근작 :", "최근작:",
    "대표분야 :", "대표분야:", "더보기", "접기", "펼치기", "목차 접기", "목차 펼치기",
)


def _inner_by_id(html_text: str, elem_id: str) -> str | None:
    """id=elem_id 인 요소의 내부 HTML을 (중첩 div를 고려해) 잘라낸다."""
    m = re.search(r'<(\w+)[^>]*\bid="%s"[^>]*>' % re.escape(elem_id), html_text)
    if not m:
        return None
    tag = m.group(1)
    start = m.end()
    open_re = re.compile(r"<%s\b" % re.escape(tag), re.I)
    close_re = re.compile(r"</%s\s*>" % re.escape(tag), re.I)
    depth, i = 1, start
    while depth > 0:
        nc = close_re.search(html_text, i)
        if not nc:
            return html_text[start:]
        no = open_re.search(html_text, i)
        if no and no.start() < nc.start():
            depth += 1
            i = no.end()
        else:
            depth -= 1
            i = nc.end()
            if depth == 0:
                return html_text[start:nc.start()]
    return html_text[start:]


def _to_text(inner: str | None) -> str:
    """HTML 조각을 줄바꿈 보존 평문으로. 보일러플레이트 줄 제거 + 빈 줄 정리."""
    if not inner:
        return ""
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", inner)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = _html.unescape(s)
    out: list[str] = []
    for raw in s.split("\n"):
        ln = raw.strip()
        if not ln:
            if out and out[-1] != "":
                out.append("")
            continue
        if any(bp in ln for bp in _BOILERPLATE):
            continue
        out.append(ln)
    return "\n".join(out).strip()


def _extract_intro(intro_html: str) -> str:
    """Introduce 응답에서 책소개 본문만(목차 영역 시작 전까지) 분리."""
    rm = re.search(r'<div class="Ere_prod_mconts_R">', intro_html)
    if not rm:
        return ""
    start = rm.end()
    cut = len(intro_html)
    for marker in ('id="tocTemplate"', 'id="div_TOC_Short"', 'id="div_TOC_All"'):
        k = intro_html.find(marker, start)
        if k != -1:
            cut = min(cut, k)
    return _to_text(intro_html[start:cut])


async def _get(client: httpx.AsyncClient, isbn: str, name: str) -> str | None:
    try:
        r = await client.get(_GETCONTENTS, params={"isbn": isbn, "name": name})
        r.raise_for_status()
        return r.text
    except Exception:
        logging.warning("알라딘 콘텐츠 스크래핑 실패(name=%s)", name, exc_info=True)
        return None


async def scrape_contents(isbn13: str, referer: str | None = None) -> dict:
    """상품 페이지 콘텐츠를 긁어 {toc, full_description, author_intro,
    publisher_description} 중 채워진 것만 반환. 실패는 조용히 건너뛴다."""
    result: dict[str, str] = {}
    headers = {"User-Agent": _UA}
    if referer:
        headers["Referer"] = referer
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers) as client:
            intro = await _get(client, isbn13, "Introduce")
            if intro:
                fd = _extract_intro(intro)
                if fd:
                    result["full_description"] = fd
                toc = _to_text(_inner_by_id(intro, "div_TOC_All"))
                if toc:
                    result["toc"] = toc

            author = await _get(client, isbn13, "AuthorInfo")
            if author:
                bios = [
                    _to_text(_inner_by_id(author, aid))
                    for aid in re.findall(r'id="(div_AuthorInfo_\d+_All)"', author)
                ]
                bios = [b for b in bios if b]
                if bios:
                    result["author_intro"] = "\n\n".join(bios)

            pub = await _get(client, isbn13, "PublisherDesc")
            if pub:
                pd = _to_text(_inner_by_id(pub, "div_PublisherDesc_All"))
                if pd:
                    result["publisher_description"] = pd
    except Exception:
        logging.warning("알라딘 콘텐츠 스크래핑 전체 실패(isbn=%s)", isbn13, exc_info=True)
    return result
