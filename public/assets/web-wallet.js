// =============================================================================
// /wallet 지갑·충전 예비 랜딩 — 로그인 여부에 따른 잔액 카드 분기만 담당한다.
// 잔액 API는 아직 존재하지 않는다(bbbb_wallets 스키마만 존재) — 절대 호출 금지.
// 로드 순서: supabase CDN → web-common.js → web-viewer-nav.js → web-wallet.js
// GW 부재·세션 조회 실패 시에는 로그아웃 뷰(기본 마크업 상태)로 조용히 폴백한다.
// =============================================================================

(function () {
  "use strict";

  function setBalanceView(loggedIn) {
    var amount = document.getElementById("wallet-balance-amount");
    var suffix = document.getElementById("wallet-balance-suffix");
    var noteOut = document.getElementById("wallet-note-out");
    var noteIn = document.getElementById("wallet-note-in");
    if (amount) amount.textContent = loggedIn ? "0 크레딧" : "—";
    if (suffix) suffix.hidden = !loggedIn;
    if (noteOut) noteOut.hidden = loggedIn;
    if (noteIn) noteIn.hidden = !loggedIn;
  }

  function init() {
    var GW = window.GW;
    if (!GW || typeof GW.getSession !== "function") {
      setBalanceView(false);
      return;
    }
    Promise.resolve()
      .then(function () {
        return GW.getSession();
      })
      .then(function (session) {
        setBalanceView(Boolean(session));
      })
      .catch(function () {
        setBalanceView(false);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
