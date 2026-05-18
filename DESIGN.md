---
version: beta
name: 계이득 Public Site
description: Public download, account, and legal notice site for 계이득
defaultMode: dark
colors:
  primary: "#F8FBFF"
  secondary: "#AEB8C9"
  muted: "#7D8AA0"
  page: "#070A10"
  surface: "#101622"
  surface-2: "#151D2C"
  border: "#2B3548"
  blue: "#0F6BFF"
  cyan: "#23C8FF"
  magenta: "#8C4DFF"
  green: "#24CA86"
typography:
  h1:
    fontFamily: Inter
    fontSize: 4rem
    fontWeight: 950
    lineHeight: 1.02
    letterSpacing: "0"
  h2:
    fontFamily: Inter
    fontSize: 2.625rem
    fontWeight: 930
    lineHeight: 1.08
    letterSpacing: "0"
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.58
    letterSpacing: "0"
rounded:
  default: 8px
spacing:
  section: 68px
  card: 22px
components:
  header:
    height: 76px
    layout: logo / category nav / actions
  category-nav:
    behavior: sticky under header
    purpose: expose product categories like a creator platform site
  hero:
    layout: split copy and generated product visual
    image: "/assets/gyeideuk-product-visual.png"
  brand-logo:
    image: "/assets/gyeideuk-logo.png"
    width: 160px
    height: 54px
  cards:
    radius: 8px
    usage: repeated features, flow steps, setup steps, timeline items
---

## Overview

계이득의 공개 사이트는 다운로드용 단순 페이지가 아니라 크리에이터용 후원 도구 소개 사이트로 보이게 한다. Google `design.md` 방식처럼 토큰, 구조, 의도, 금지사항을 문서화하고 실제 CSS와 같은 값을 유지한다. 투네이션 사이트에서는 상단 카테고리 탐색, 큰 첫 화면, 기능 카테고리 카드, 업데이트/가이드 흐름, 법적 푸터 구조를 참고하되 문구와 시각 요소는 계이득 고유 목적에 맞춘다.

## Public Positioning

계이득은 "계좌 입금 알림을 방송 리액션으로 바꾸는 Windows 프로그램"으로 설명한다. 공개 페이지에서는 내부 호스팅, 데이터베이스, 배포 시스템 이름을 노출하지 않는다. 사용자가 이해해야 하는 핵심 흐름은 계좌 알림 감지, 조건 매칭, OBS 출력, 공유 코드 설정이다.

## Visual Assets

헤더와 푸터 로고는 `/assets/gyeideuk-logo.png`를 사용한다. 메인 히어로 비주얼은 ChatGPT 이미지 생성 기능으로 만든 `/assets/gyeideuk-product-visual.png`를 사용하며, 이미지 안에는 읽을 수 있는 텍스트나 외부 브랜드 로고를 넣지 않는다. 기존 브랜드 배너 `/assets/gyeideuk-hero.png`는 보존하되 현재 첫 화면의 주 시각 자산으로는 사용하지 않는다.

## Layout

헤더는 로고, 중앙 메뉴, 우측 액션으로 구성한다. 헤더 아래에는 투네이션식 카테고리 바를 두어 시그니처, 미디어, 벽지, 랭킹, 공유 코드, OBS 연결을 빠르게 스캔하게 한다. 본문은 히어로, 상태, 카테고리, 기능, 작동 방식, 업데이트, 다운로드, 설치, 계정, 푸터 순서다.

## Components

카드는 반복 아이템에만 사용한다. 페이지 섹션 자체를 카드처럼 띄우지 않는다. 버튼과 카드 모서리는 8px를 기본으로 한다. 큰 장식용 CSS gradient, blob, orb, SVG 배경은 사용하지 않고 실제 이미지 자산이나 단색 표면으로 깊이를 만든다.

## Modes

다크 모드가 기본이다. 방송 도구와 OBS 사용 맥락에서는 낮은 눈부심이 유리하기 때문이다. 화이트 모드는 브라우저에서 계정과 다운로드를 관리하는 사용자를 위해 유지한다.

## Do's

- 다운로드 경로와 최신 버전 상태를 첫 화면 이후 바로 확인할 수 있게 유지한다.
- 기능을 "계좌 알림 → 조건 매칭 → OBS 출력" 흐름으로 설명한다.
- 계정 기능은 사용자 관리 관점으로 표현한다.
- 법적 고지는 푸터에 상시 노출한다.
- 생성형 이미지는 보조 비주얼로 쓰고, 로고와 제품명은 실제 브랜드 자산과 HTML 텍스트로 처리한다.

## Don'ts

- 공개 페이지에 내부 서버, 데이터베이스, 배포 서비스 이름을 노출하지 않는다.
- 카드 안에 카드를 넣지 않는다.
- hero를 텍스트 없는 이미지만으로 만들지 않는다.
- 버튼과 카드 텍스트가 모바일에서 잘리지 않게 한다.
- 사이트 전체를 단일 보라/파랑 계열로만 밀지 않는다.
