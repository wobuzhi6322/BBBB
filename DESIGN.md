---
version: variant-d
name: 계이득 Public Site
description: Public download, account, and legal notice site for 계이득 — playful sticker/coupon language (design D)
defaultMode: light
colors:
  cream: "#FFF7EA"
  paper: "#FFFDF7"
  ink: "#17265C"
  ink-soft: "#4A5680"
  blue: "#2E53FF"
  blue-deep: "#1D3BD1"
  yellow: "#FFCE31"
  yellow-soft: "#FFE58A"
  mint: "#93E5C1"
  pink: "#FFB3C7"
  lav: "#C9B8FF"
  red: "#FF5A5A"
  dark-page: "#0B1130"
  dark-surface: "#141C46"
  dark-ink: "#FFF3DC"
  dark-edge: "#F2ECD9"
typography:
  h1:
    fontFamily: Jua
    fontSize: "clamp(2.35rem, 5.4vw, 3.9rem)"
    fontWeight: 400
    lineHeight: 1.18
  h2:
    fontFamily: Jua
    fontSize: "clamp(1.65rem, 3.4vw, 2.45rem)"
    fontWeight: 400
    lineHeight: 1.28
  body:
    fontFamily: Pretendard Variable
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.62
    wordBreak: keep-all
border:
  width: 2.5px (cards, buttons) / 2px (chips, inputs)
  color: ink (light) / cream edge (dark)
  dashed: 절취선·펀치홀·행 구분선에 사용
shadow:
  grammar: "오프셋 단색 하드섀도 — box-shadow: 4px 4px 0 var(--hard), 블러 0"
  hover: "translate(-2px,-2px) + 6px 6px 0"
  active: "translate(2px,2px) + 1px 1px 0"
rounded:
  card: 16-26px
  pill: 999px
spacing:
  section: "clamp(56px, 8vw, 84px)"
  card: 24px
components:
  header:
    height: 72px
    look: 크림 반투명 + blur + 두꺼운 하단 보더, sticky
  eyebrow:
    look: Jua 말풍선 칩 — 보더 + 하드섀도 + rotate(-2deg), 섹션별 파스텔 배경
  hero:
    layout: 좌 카피 / 우 CSS 도형 무대(3단 흐름 쿠폰 + 별 스티커 + 도장 스탬프 + 코인)
    background: 잉크 도트 그리드(radial-gradient)
  release-panel:
    look: 옐로 쿠폰 — 펀치홀(::before/::after) + 하드섀도
  pricing-card:
    look: 쿠폰 카드 — plan-head 아래 절취선(dashed) + 펀치홀, 추천 배지는 빨간 도장 스탬프
  brand-logo:
    image: "/assets/gyeideuk-logo.png"
    dark: "filter: invert(1) hue-rotate(180deg)"
  footer:
    look: 네이비 잉크 풀블리드, 크림 텍스트, 로고 invert
---

## Overview

계이득 공개 사이트는 디자인 언어 D("스티커/쿠폰" 룩)를 쓴다. 밝은 크림 배경 위에 전기 블루와 햇살 옐로 2색, 네이비 잉크 텍스트. 모든 카드·버튼·칩은 두꺼운 네이비 보더(2~2.5px)와 블러 없는 오프셋 하드섀도를 가지며, 살짝 기울인 요소·절취선·펀치홀·도장 스탬프로 "손으로 붙인 쿠폰북" 느낌을 만든다. 일러스트는 외부 이미지 없이 CSS 도형(별 clip-path, 코인, 대시 원)으로 그린다. 원본 룩은 `ideukgae/public/landing-variants/d-playful.html`에서 왔고, 이 사이트의 소구(프로그램: 계좌 알림 → 조건 매칭 → OBS 출력)에 맞게 번역했다.

## Public Positioning

계이득은 "계좌 입금 알림을 방송 리액션으로 바꾸는 Windows 프로그램"으로 설명한다. 공개 페이지에서는 내부 호스팅, 데이터베이스, 배포 시스템 이름을 노출하지 않는다. 사용자가 이해해야 하는 핵심 흐름은 계좌 알림 감지, 조건 매칭, OBS 출력, 공유 코드 설정이다. 카피는 사실관계를 유지하되 D 톤(직설 위트, 예: "계좌에 딩동 하면, 방송엔 바로 팡!", 스탬프 "돈은 안 만져요, 알림만 읽어요")으로 쓴다. 결제/수수료 관련 주장은 만들지 않는다 — 계이득은 결제를 중개하지 않는 프로그램이다.

## Visual Assets

헤더와 푸터 로고는 `/assets/gyeideuk-logo.png`를 사용한다. 크림 배경에서는 원본, 다크와 네이비 푸터에서는 `invert(1) hue-rotate(180deg)`. 히어로는 생성 이미지 대신 CSS 도형 무대(3단 흐름 쿠폰, 별 스티커, 도장 스탬프, 코인, 스파크)를 쓴다. 제품 스크린샷(`product-signatures.png`, `product-media.png`)은 두꺼운 보더 + 하드섀도 프레임에 살짝 기울여 담는다. 폰트는 Jua(제목, 구글 폰트 CDN)와 Pretendard Variable(본문, jsdelivr CDN)을 site.css 상단 `@import`로 불러온다.

## Layout

헤더는 로고, 중앙 메뉴, 우측 액션(테마 토글·로그인·다운로드 알약 버튼). 본문은 히어로(카피+무대+요약 스티커 3장), 상태 칩, 카테고리 칩, 기능 쇼케이스, 작동 방식(크림 딥 밴드 + 번호 스티커 카드 4장), 세팅법(종이 카드 2장), 실제 화면, 업데이트 타임라인, 요금(쿠폰 카드 3장 + 옵션 패널), 다운로드(옐로 쿠폰), 계정 대시보드, 네이비 푸터 순서다. 작동 방식 밴드는 `box-shadow 100vmax + clip-path` 풀블리드 기법을 쓴다.

## Components

- 버튼: 알약(999px), 두꺼운 보더, `4px 4px 0` 하드섀도. hover는 좌상단으로 -2px 이동 + 그림자 확대, active는 우하단 +2px + 그림자 축소. primary=블루, secondary=페이퍼.
- 키커(.eyebrow): Jua 말풍선 칩, rotate(-2deg), 섹션별 파스텔(옐로/민트/핑크/라벤더).
- 쿠폰: 요금 카드는 plan-head 아래 절취선(dashed)과 양쪽 펀치홀(배경색 원), 다운로드 패널은 옐로 쿠폰 + 좌우 펀치홀.
- 스탬프: 추천 배지는 빨간 대시 원형 도장, 히어로에는 "돈은 안 만져요" 대시 원 스탬프.
- 행 구분선: 실선 대신 2px dashed 잉크(계정 리스트는 35% 투명 잉크).
- 입력: 흰 배경, 2px 보더, 12px 라운드. 폼 메시지는 라이트에서 딥블루, 다크에서 옐로.
- 기울임: 카드·칩에 ±0.4~2.5deg. 본문 텍스트 블록은 기울이지 않는다.

## Modes

라이트(크림)가 기본이다. D 언어의 정체성이 밝은 크림이기 때문. 첫 방문 시 각 페이지의 인라인 스크립트가 `bbbb-site-theme`을 "light"로 시드해 site.js(수정 금지)가 라이트를 적용하게 한다. 다크는 같은 문법의 나이트 버전: 크림→딥네이비(#0B1130), 잉크→크림(#FFF3DC), 보더는 크림 엣지, 하드섀도는 근흑 네이비. 옐로 쿠폰·파스텔 스티커는 다크에서도 그대로 유지하고 그 위 텍스트는 테마 무관 네이비(`--ink-fix`)를 쓴다. 토글은 site.js가 처리하며 `data-theme` 계약(light/dark)을 바꾸지 않는다.

## Do's

- 색은 크림/블루/옐로/네이비 + 파스텔 포인트(민트·핑크·라벤더)만 쓴다.
- 그림자는 항상 블러 0 오프셋 단색(하드섀도)으로 쓴다.
- 제목은 Jua(단일 400 웨이트), 본문은 Pretendard. 한국어는 `word-break: keep-all`.
- 기능은 "계좌 알림 → 조건 매칭 → OBS 출력" 흐름으로 설명한다.
- site.js가 참조하는 id·클래스(`is-hidden`, `has-modal`, `is-visible`, `button primary/secondary`, `compact-button`, `admin-device-row`, `account-empty`, `[data-close-login]`)와 폼 구조를 보존한다.
- 법적 고지는 푸터에 상시 노출하고 문구를 바꾸지 않는다.

## Don'ts

- 블러 있는 그림자, 글래스모피즘, 그라디언트 배경을 쓰지 않는다(다크에서도 동일).
- 공개 페이지에 내부 서버, 데이터베이스, 배포 서비스 이름을 노출하지 않는다.
- 수수료·정산 등 결제 관련 주장을 만들지 않는다 — 프로그램은 알림만 읽는다.
- Jua에 bold를 걸지 않는다(단일 웨이트, faux-bold 흐림 발생).
- 본문 문단을 기울이지 않는다 — 기울임은 칩·카드·스티커 장식에만.
- site.js를 수정하거나 site.js가 쓰는 DOM 계약(id, 클래스, data 속성, localStorage 키 `bbbb-site-theme`)을 깨지 않는다.
