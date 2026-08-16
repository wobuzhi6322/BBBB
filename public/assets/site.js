const state = {
  config: null,
  release: null,
  mobileRelease: null,
  supabase: null,
  session: null,
  authReady: false,
  pendingProfileNavigation: false,
  account: null,
  authMode: "login",
  passwordRecovery: false,
  adminLicenseTarget: null,
  adminDeviceTargetEmail: null,
  theme: "dark"
};

const themeStorageKey = "bbbb-site-theme";
const featureKeys = ["signatures", "wallpapers", "tagBattle", "chatRace", "manualOverlays"];
const featureLabels = {
  signatures: "시그니처",
  wallpapers: "벽지",
  tagBattle: "태그 대결",
  chatRace: "채팅 레이스",
  manualOverlays: "수동 오버레이"
};
const defaultFeatureFlags = Object.fromEntries(featureKeys.map((key) => [key, true]));

const els = {
  siteStatus: document.getElementById("site-status"),
  releaseStatus: document.getElementById("release-status"),
  releaseName: document.getElementById("release-name"),
  releaseMeta: document.getElementById("release-meta"),
  releaseNotes: document.getElementById("release-notes"),
  releaseLink: document.getElementById("release-link"),
  downloadButton: document.getElementById("download-button"),
  mobileReleaseName: document.getElementById("mobile-release-name"),
  mobileReleaseMeta: document.getElementById("mobile-release-meta"),
  mobileDownloadButton: document.getElementById("mobile-download-button"),
  loginForm: document.getElementById("login-form"),
  loginButton: document.getElementById("login-button"),
  signupButton: document.getElementById("signup-button"),
  resetPasswordButton: document.getElementById("reset-password-button"),
  savePasswordButton: document.getElementById("save-password-button"),
  logoutButton: document.getElementById("logout-button"),
  authMessage: document.getElementById("auth-message"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  passwordConfirm: document.getElementById("password-confirm"),
  capsLockWarning: document.getElementById("caps-lock-warning"),
  passwordStrength: document.getElementById("password-strength"),
  passwordStrengthBar: document.getElementById("password-strength-bar"),
  passwordStrengthLabel: document.getElementById("password-strength-label"),
  passwordStrengthHint: document.getElementById("password-strength-hint"),
  signupChannelFields: document.getElementById("signup-channel-fields"),
  signupChannelPlatform: document.getElementById("signup-channel-platform"),
  signupChannelName: document.getElementById("signup-channel-name"),
  signupChannelUrl: document.getElementById("signup-channel-url"),
  themeToggle: document.getElementById("theme-toggle"),
  headerAccount: document.getElementById("header-account"),
  headerAdmin: document.getElementById("header-admin"),
  navAccount: document.getElementById("nav-account"),
  loginDialog: document.getElementById("login-dialog"),
  dashboardMessage: document.getElementById("dashboard-message"),
  profileSection: document.getElementById("profile"),
  dashboardContent: document.getElementById("dashboard-content"),
  profileCard: document.getElementById("profile-card"),
  profileInitial: document.getElementById("profile-initial"),
  userEmail: document.getElementById("user-email"),
  accountRole: document.getElementById("account-role"),
  licensePlan: document.getElementById("license-plan"),
  licenseStatus: document.getElementById("license-status"),
  licenseCode: document.getElementById("license-code"),
  licenseLimits: document.getElementById("license-limits"),
  sharedCodeList: document.getElementById("shared-code-list"),
  deviceList: document.getElementById("device-list"),
  downloadList: document.getElementById("download-list"),
  redeemCodeForm: document.getElementById("redeem-code-form"),
  redeemCodeInput: document.getElementById("redeem-code-input"),
  redeemCodeMessage: document.getElementById("redeem-code-message"),
  redeemCodeResult: document.getElementById("redeem-code-result"),
  profileChannelForm: document.getElementById("profile-channel-form"),
  profileChannelPlatform: document.getElementById("profile-channel-platform"),
  profileChannelName: document.getElementById("profile-channel-name"),
  profileChannelUrl: document.getElementById("profile-channel-url"),
  profileChannelSummary: document.getElementById("profile-channel-summary"),
  profileChannelMessage: document.getElementById("profile-channel-message"),
  accountDeleteForm: document.getElementById("account-delete-form"),
  accountDeleteConfirm: document.getElementById("account-delete-confirm"),
  accountDeleteButton: document.getElementById("account-delete-button"),
  accountDeleteMessage: document.getElementById("account-delete-message"),
  adminLicensePanel: document.getElementById("admin-license-panel"),
  adminLicenseForm: document.getElementById("admin-license-form"),
  adminLicenseEmail: document.getElementById("admin-license-email"),
  adminLicensePlan: document.getElementById("admin-license-plan"),
  adminLicenseStatus: document.getElementById("admin-license-status"),
  adminLicenseExpires: document.getElementById("admin-license-expires"),
  adminLicenseAddSignatures: document.getElementById("admin-license-add-signatures"),
  adminLicenseAddMediaMb: document.getElementById("admin-license-add-media-mb"),
  adminLicenseNotes: document.getElementById("admin-license-notes"),
  adminLicenseMessage: document.getElementById("admin-license-message"),
  adminLicenseLookup: document.getElementById("admin-license-lookup"),
  adminLicenseUpdate: document.getElementById("admin-license-update"),
  adminLicenseResult: document.getElementById("admin-license-result"),
  adminDeviceLookup: document.getElementById("admin-device-lookup"),
  adminDeviceClearAll: document.getElementById("admin-device-clear-all"),
  adminDeviceMessage: document.getElementById("admin-device-message"),
  adminDeviceResult: document.getElementById("admin-device-result"),
  adminCodeForm: document.getElementById("admin-code-form"),
  adminCodeMode: document.getElementById("admin-code-mode"),
  adminCodePlan: document.getElementById("admin-code-plan"),
  adminCodeDurationUnit: document.getElementById("admin-code-duration-unit"),
  adminCodeDurationValue: document.getElementById("admin-code-duration-value"),
  adminCodeMaxRedemptions: document.getElementById("admin-code-max-redemptions"),
  adminCodeValidUntil: document.getElementById("admin-code-valid-until"),
  adminCodeNotes: document.getElementById("admin-code-notes"),
  adminCodeMessage: document.getElementById("admin-code-message"),
  adminCodeResult: document.getElementById("admin-code-result")
};

init().catch((error) => {
  setText(els.siteStatus, `사이트 초기화 실패: ${error.message}`);
});

async function init() {
  setupTheme();
  setupProgramShowcases();
  setupOverlayCatalogFilters();
  await loadConfig();
  setupAccountNavigation();
  setupAuth();

  if (els.downloadButton && els.releaseStatus) {
    await loadRelease();
    await loadMobileRelease();
    setupDownload();
  }

  setupLoginDialog();
  if (els.headerAdmin) {
    setupAdminEntry();
  }
  if (els.redeemCodeForm) {
    setupRedeemCodeForm();
  }
  if (els.profileChannelForm) {
    setupProfileChannelForm();
  }
  if (els.accountDeleteForm) {
    setupAccountDeleteForm();
  }
  if (els.adminLicenseForm) {
    setupAdminLicenseForm();
  }
  if (els.adminDeviceLookup) {
    setupAdminDevicePanel();
  }
  if (els.adminCodeForm) {
    setupAdminCodeForm();
  }

}

function setupTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  applyTheme(savedTheme === "light" ? "light" : "dark");
  els.themeToggle?.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });
}

function setupProgramShowcases() {
  document.querySelectorAll("[data-program-showcase]").forEach((showcase) => {
    const buttons = Array.from(showcase.querySelectorAll("[data-showcase-target]"));
    const panels = Array.from(showcase.querySelectorAll("[data-showcase-panel]"));
    if (!buttons.length || !panels.length) {
      return;
    }

    const activate = (target) => {
      buttons.forEach((button) => {
        const active = button.dataset.showcaseTarget === target;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.showcasePanel !== target;
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => activate(button.dataset.showcaseTarget));
    });

    activate(buttons.find((button) => button.classList.contains("is-active"))?.dataset.showcaseTarget || buttons[0].dataset.showcaseTarget);
  });
}

function setupOverlayCatalogFilters() {
  const filters = Array.from(document.querySelectorAll("[data-overlay-filter]"));
  const cards = Array.from(document.querySelectorAll("[data-overlay-group]"));
  if (!filters.length || !cards.length) {
    return;
  }

  const applyFilter = (group) => {
    filters.forEach((button) => {
      const active = button.dataset.overlayFilter === group;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    cards.forEach((card) => {
      const visible = group === "all" || card.dataset.overlayGroup === group;
      card.classList.toggle("is-hidden", !visible);
    });
  };

  filters.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => applyFilter(button.dataset.overlayFilter || "all"));
  });
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem(themeStorageKey, state.theme);
  if (!els.themeToggle) {
    return;
  }
  const isDark = state.theme === "dark";
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
  els.themeToggle.setAttribute("title", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
  els.themeToggle.setAttribute("aria-label", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
}

async function loadConfig() {
  const result = await getJson("/api/site-config");
  state.config = result.data;
  if (state.config.supabase.enabled) {
    setText(els.siteStatus, "계정 기능 사용 가능");
  } else {
    setText(els.siteStatus, "Windows 앱 · OBS 오버레이 제공");
  }
}

async function loadRelease() {
  try {
    const result = await getJson("/api/releases");
    state.release = result.data.release;
    const releasesUrl = result.data.releasesUrl || "#";
    if (els.releaseLink) {
      els.releaseLink.href = releasesUrl;
    }

    if (!state.release) {
      setText(els.releaseStatus, "아직 등록된 최신 버전이 없습니다.");
      setText(els.releaseName, "버전 없음");
      setText(els.releaseMeta, "배포 파일이 등록되면 다운로드 버튼이 활성화됩니다.");
      els.downloadButton.disabled = false;
      setText(els.downloadButton, "릴리즈 페이지 열기");
      return;
    }

    const asset = state.release.downloadAsset;
    const published = state.release.publishedAt ? formatDate(state.release.publishedAt) : "게시일 없음";
    setText(els.releaseStatus, `${state.release.tagName} 다운로드 준비됨`);
    setText(els.releaseName, state.release.name);
    setText(
      els.releaseMeta,
      asset
        ? `${published} · ${asset.name} · ${formatBytes(asset.size)}`
        : `${published} · ZIP 다운로드로 연결`
    );
    if (els.releaseLink) {
      els.releaseLink.href = state.release.htmlUrl;
    }
    els.downloadButton.disabled = false;
    setText(els.downloadButton, "Windows 다운로드");

    if (els.releaseNotes) {
      els.releaseNotes.classList.remove("is-visible");
      setText(els.releaseNotes, "");
    }
  } catch {
    setText(els.releaseStatus, "최신 버전 확인에 실패했습니다.");
    setText(els.releaseName, "확인 실패");
    setText(els.releaseMeta, "잠시 후 다시 확인해 주세요.");
  }
}

async function loadMobileRelease() {
  if (!els.mobileDownloadButton) {
    return;
  }
  try {
    const result = await getJson("/api/mobile-release");
    state.mobileRelease = result.data.release;
    if (!state.mobileRelease) {
      setText(els.mobileReleaseName, "Android APK 없음");
      setText(els.mobileReleaseMeta, "APK 파일이 등록되면 다운로드가 활성화됩니다.");
      setText(els.mobileDownloadButton, "APK 준비 중");
      els.mobileDownloadButton.disabled = true;
      return;
    }
    const asset = state.mobileRelease.downloadAsset;
    const published = state.mobileRelease.publishedAt ? formatDate(state.mobileRelease.publishedAt) : "게시일 없음";
    setText(els.mobileReleaseName, state.mobileRelease.name);
    setText(
      els.mobileReleaseMeta,
      asset ? `${published} · ${asset.name} · ${formatBytes(asset.size)}` : `${published} · APK 다운로드`
    );
    setText(els.mobileDownloadButton, "Android APK 다운로드");
    els.mobileDownloadButton.disabled = false;
  } catch {
    setText(els.mobileReleaseName, "확인 실패");
    setText(els.mobileReleaseMeta, "잠시 후 다시 확인해 주세요.");
    setText(els.mobileDownloadButton, "APK 준비 중");
    els.mobileDownloadButton.disabled = true;
  }
}

function setupDownload() {
  els.downloadButton.addEventListener("click", () => {
    const release = state.release;
    const url = release?.downloadUrl || state.config?.github?.releasesUrl || "#";
    if (release) {
      void logDownload(release);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });

  els.mobileDownloadButton?.addEventListener("click", () => {
    const release = state.mobileRelease;
    const url = release?.downloadUrl || "#";
    if (url !== "#") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
}

function setupLoginDialog() {
  document.querySelectorAll("[data-close-login]").forEach((button) => {
    button.addEventListener("click", closeLoginDialog);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLoginDialog();
    }
  });
}

function setupAccountNavigation() {
  els.headerAccount?.addEventListener("click", openAccountTarget);
  els.navAccount?.addEventListener("click", openAccountTarget);
  window.addEventListener("hashchange", handleAccountHash);
  handleAccountHash();
}

function setupAdminEntry() {
  els.headerAdmin?.addEventListener("click", async (event) => {
    event.preventDefault();
    const token = state.session?.access_token;
    if (!token) {
      openLoginDialog();
      return;
    }

    try {
      setText(els.authMessage, "관리자 페이지를 여는 중입니다.");
      await postJsonWithAuth("/api/admin-session", token, {});
      window.location.href = "/admin/";
    } catch (error) {
      setText(els.authMessage, error instanceof Error ? error.message : "관리자 페이지를 열 수 없습니다.");
      openLoginDialog();
    }
  });
}

function openAccountTarget(event) {
  event?.preventDefault();
  state.pendingProfileNavigation = true;
  if (!state.authReady) {
    setText(els.authMessage, "계정 상태를 확인하는 중입니다.");
    return;
  }
  if (state.session?.user) {
    navigateToProfile();
    return;
  }
  state.pendingProfileNavigation = false;
  window.location.href = "/login.html";
}

function openLoginDialog() {
  if (isLoginPage()) {
    window.setTimeout(() => els.email?.focus(), 0);
    return;
  }
  els.loginDialog?.classList.remove("is-hidden");
  document.body.classList.add("has-modal");
  window.setTimeout(() => els.email?.focus(), 0);
}

function closeLoginDialog() {
  if (isLoginPage()) {
    if (!state.passwordRecovery) {
      setAuthMode("login");
    }
    return;
  }
  els.loginDialog?.classList.add("is-hidden");
  document.body.classList.remove("has-modal");
  if (!state.passwordRecovery) {
    setAuthMode("login");
  }
}

function handleAccountHash() {
  if (window.location.hash !== "#login") {
    return;
  }
  if (!state.authReady) {
    return;
  }
  if (state.session?.user) {
    closeLoginDialog();
    clearLoginHash();
    return;
  }
  openLoginDialog();
}

function navigateToProfile() {
  state.pendingProfileNavigation = false;
  closeLoginDialog();
  clearLoginHash();
  const target = profileDestination();
  if (target === "/profile.html" && isProfilePage()) {
    return;
  }
  window.location.href = target;
}

function clearLoginHash() {
  if (window.location.hash === "#login") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function isProfilePage() {
  return window.location.pathname.endsWith("/profile.html") || window.location.pathname.endsWith("/profile");
}

function isLoginPage() {
  return window.location.pathname.endsWith("/login.html") || window.location.pathname.endsWith("/login");
}

// 마지막 로그인 역할 마커 — 스트리머 로그인(site.js)과 시청자 로그인
// (web-viewer-login.js, 같은 키)이 각자 성공 시점에 기록한다. /login 재방문 시
// 복원된 세션을 역할에 맞는 페이지로 보내는 용도로만 읽는다.
const LAST_LOGIN_ROLE_KEY = "gw-last-login-role";

function readLastLoginRole() {
  try {
    return window.localStorage.getItem(LAST_LOGIN_ROLE_KEY);
  } catch {
    return null;
  }
}

function saveLastLoginRole(role) {
  try {
    window.localStorage.setItem(LAST_LOGIN_ROLE_KEY, role);
  } catch {
    // 프라이빗 모드 등 저장 실패 시 마커 없이 기존 흐름 유지
  }
}

// 로그인 상태의 "내 프로필" 목적지 — 마지막 로그인이 시청자면 /me(시청자 홈),
// 그 외(스트리머·마커 없음)는 프로그램 계정 센터(/profile.html)를 유지한다.
function profileDestination() {
  return readLastLoginRole() === "viewer" ? "/me" : "/profile.html";
}

function setupAuth() {
  setupAuthFormEvents();
  if (!state.config?.supabase?.enabled || !window.supabase?.createClient) {
    setText(els.authMessage, "계정 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    state.authReady = true;
    renderSession();
    return;
  }

  state.supabase = window.supabase.createClient(state.config.supabase.url, state.config.supabase.anonKey);
  if (isPasswordRecoveryUrl()) {
    setPasswordRecoveryMode(true);
  }
  state.supabase.auth.getSession().then(({ data }) => {
    state.session = data.session;
    state.authReady = true;
    if (state.passwordRecovery && data.session) {
      setPasswordRecoveryMode(true);
    }
    renderSession();
  }).catch(() => {
    state.session = null;
    state.authReady = true;
    renderSession();
  });
  state.supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") {
      return;
    }
    state.session = session;
    state.authReady = true;
    if (event === "PASSWORD_RECOVERY") {
      setPasswordRecoveryMode(true);
    }
    renderSession();
  });
}

function setupAuthFormEvents() {
  els.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.passwordRecovery) {
      await updatePassword();
      return;
    }
    if (state.authMode === "signup") {
      await signUp();
      return;
    }
    await signIn();
  });
  els.signupButton?.addEventListener("click", toggleSignupMode);
  els.resetPasswordButton?.addEventListener("click", sendPasswordResetEmail);
  els.savePasswordButton?.addEventListener("click", updatePassword);
  els.logoutButton?.addEventListener("click", signOut);
  els.password?.addEventListener("input", updatePasswordStrength);
  els.passwordConfirm?.addEventListener("input", syncPasswordConfirmation);
  setupCapsLockWarning([els.password, els.passwordConfirm], els.capsLockWarning);
  setAuthMode(state.passwordRecovery ? "recovery" : "login");
}

function setupAdminLicenseForm() {
  els.adminLicenseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createAdminLicense();
  });
  els.adminLicenseLookup?.addEventListener("click", lookupAdminLicenses);
  els.adminLicenseUpdate?.addEventListener("click", updateAdminLicense);
}

function setupAdminDevicePanel() {
  els.adminDeviceLookup?.addEventListener("click", () => lookupAdminDevices());
  els.adminDeviceClearAll?.addEventListener("click", clearAllAdminDevices);
  els.adminDeviceResult?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-admin-device-delete]") : null;
    if (!button) {
      return;
    }
    void deleteAdminDevice(button.dataset.adminDeviceDelete);
  });
}

function setupRedeemCodeForm() {
  els.redeemCodeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await redeemLicenseCode();
  });
}

function setupProfileChannelForm() {
  els.profileChannelForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveProfileChannel();
  });
}

function setupAccountDeleteForm() {
  const syncDeleteButton = () => {
    if (els.accountDeleteButton) {
      els.accountDeleteButton.disabled = els.accountDeleteConfirm?.value.trim() !== "계정 탈퇴";
    }
  };
  els.accountDeleteConfirm?.addEventListener("input", syncDeleteButton);
  els.accountDeleteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await deleteAccount();
  });
  syncDeleteButton();
}

function toggleSignupMode() {
  if (state.authMode === "signup") {
    setAuthMode("login");
    setText(els.authMessage, "로그인 정보를 입력해 주세요.");
    return;
  }
  setAuthMode("signup");
  setText(els.authMessage, "회원가입 정보를 입력해 주세요. 채널 정보는 가입할 때만 저장됩니다.");
}

function setAuthMode(mode) {
  state.authMode = mode;
  state.passwordRecovery = mode === "recovery";
  if (els.loginForm) {
    els.loginForm.dataset.authMode = mode;
  }
  const signupMode = mode === "signup";
  const recoveryMode = mode === "recovery";

  document.querySelectorAll("[data-signup-only]").forEach((element) => {
    element.classList.toggle("is-hidden", !signupMode);
    element.hidden = !signupMode;
  });

  if (els.passwordConfirm) {
    els.passwordConfirm.required = signupMode;
    if (!signupMode) {
      els.passwordConfirm.value = "";
      els.passwordConfirm.setCustomValidity("");
    }
  }
  if (els.password) {
    els.password.autocomplete = signupMode || recoveryMode ? "new-password" : "current-password";
    els.password.placeholder = recoveryMode ? "새 비밀번호" : "";
    els.password.minLength = signupMode ? 8 : 6;
    if (!signupMode) {
      updatePasswordStrength();
    }
  }

  els.loginButton?.classList.toggle("is-hidden", recoveryMode);
  els.signupButton?.classList.toggle("is-hidden", recoveryMode);
  els.resetPasswordButton?.classList.toggle("is-hidden", signupMode || recoveryMode);
  els.savePasswordButton?.classList.toggle("is-hidden", !recoveryMode);

  setText(els.loginButton, signupMode ? "회원가입 완료" : "로그인");
  setText(els.signupButton, signupMode ? "로그인으로 돌아가기" : "회원가입");
  updatePasswordStrength();
}

function passwordStrength(password) {
  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };
  const score = Object.values(checks).filter(Boolean).length;
  const level = score >= 5 ? "strong" : score >= 3 ? "medium" : "weak";
  const label = level === "strong" ? "강함" : level === "medium" ? "중간" : "약함";
  const width = level === "strong" ? 100 : level === "medium" ? 66 : password ? 34 : 0;
  const missing = [];
  if (!checks.length) {
    missing.push("8자 이상");
  }
  if (!checks.upper) {
    missing.push("대문자");
  }
  if (!checks.lower) {
    missing.push("소문자");
  }
  if (!checks.number) {
    missing.push("숫자");
  }
  if (!checks.special) {
    missing.push("특수문자");
  }
  return { checks, score, level, label, width, missing };
}

function updatePasswordStrength() {
  if (!els.passwordStrength || state.authMode !== "signup") {
    return;
  }
  const password = els.password?.value || "";
  const strength = passwordStrength(password);
  els.passwordStrength.dataset.strength = password ? strength.level : "empty";
  els.passwordStrength.style.setProperty("--password-strength-width", `${strength.width}%`);
  setText(els.passwordStrengthLabel, password ? strength.label : "입력 대기");
  const hint = password
    ? strength.missing.length
      ? `추가하면 좋아요: ${strength.missing.join(", ")}`
      : "좋습니다. 대문자, 소문자, 숫자, 특수문자가 모두 들어갔습니다."
    : "8자 이상, 대문자, 소문자, 숫자, 특수문자를 섞으면 강해집니다.";
  setText(els.passwordStrengthHint, hint);
  syncPasswordConfirmation();
}

function syncPasswordConfirmation() {
  if (!els.passwordConfirm || state.authMode !== "signup") {
    return;
  }
  const password = els.password?.value || "";
  const confirm = els.passwordConfirm.value || "";
  const mismatch = Boolean(confirm && password !== confirm);
  els.passwordConfirm.setCustomValidity(mismatch ? "비밀번호가 서로 맞지 않습니다." : "");
}

function setupCapsLockWarning(inputs, warning) {
  if (!warning) {
    return;
  }
  const passwordInputs = inputs.filter(Boolean);
  if (!passwordInputs.length) {
    return;
  }
  const setVisible = (visible) => {
    warning.hidden = !visible;
    warning.classList.toggle("is-visible", visible);
  };
  const updateFromEvent = (event) => {
    if (typeof event.getModifierState === "function") {
      setVisible(event.getModifierState("CapsLock"));
    }
  };
  const hideIfLeavingPasswordFields = () => {
    window.setTimeout(() => {
      if (!passwordInputs.includes(document.activeElement)) {
        setVisible(false);
      }
    }, 0);
  };
  for (const input of passwordInputs) {
    input.addEventListener("keydown", updateFromEvent);
    input.addEventListener("keyup", updateFromEvent);
    input.addEventListener("blur", hideIfLeavingPasswordFields);
  }
}

function authErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/email not confirmed/i.test(message)) {
    return "이메일 인증이 완료되지 않았습니다. 인증 메일을 확인하거나 비밀번호 찾기를 다시 진행해 주세요.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "이메일 또는 비밀번호가 올바르지 않습니다. Caps Lock과 대소문자를 확인해 주세요.";
  }
  if (/already registered|already exists|already been registered/i.test(message)) {
    return "이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 사용해 주세요.";
  }
  return message || "인증 요청에 실패했습니다.";
}

function validateSignupPassword() {
  const password = els.password?.value || "";
  const confirm = els.passwordConfirm?.value || "";
  if (password.length < 8) {
    setText(els.authMessage, "비밀번호는 8자 이상이어야 합니다.");
    els.password?.focus();
    return null;
  }
  if (password !== confirm) {
    setText(els.authMessage, "비밀번호 확인이 맞지 않습니다. 다시 입력해 주세요.");
    els.passwordConfirm?.focus();
    syncPasswordConfirmation();
    return null;
  }
  const strength = passwordStrength(password);
  if (strength.level === "weak") {
    setText(els.authMessage, "비밀번호가 약합니다. 대문자, 숫자, 특수문자를 섞어 중간 이상으로 만들어 주세요.");
    els.password?.focus();
    return null;
  }
  return password;
}

function setupAdminCodeForm() {
  els.adminCodeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createAdminCode();
  });
  els.adminCodeDurationUnit?.addEventListener("change", syncAdminCodeDurationField);
  syncAdminCodeDurationField();
}

async function signIn() {
  if (!state.supabase) {
    setText(els.authMessage, "계정 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  setText(els.authMessage, "로그인 중입니다.");
  state.pendingProfileNavigation = true;
  const { data, error } = await state.supabase.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value
  });
  if (error) {
    state.pendingProfileNavigation = false;
    setText(els.authMessage, authErrorMessage(error));
    return;
  }
  setText(els.authMessage, "로그인되었습니다.");
  if (data.session) {
    saveLastLoginRole("streamer");
    state.session = data.session;
    state.authReady = true;
    renderSession();
  }
}

async function signUp() {
  if (!state.supabase) {
    setText(els.authMessage, "계정 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  const password = validateSignupPassword();
  if (!password) {
    return;
  }
  setText(els.authMessage, "회원가입 중입니다.");
  const channel = readChannelInput("signup");
  const email = els.email.value.trim();
  let signupResult;
  try {
    signupResult = await apiJson("/api/auth-signup", {
      email,
      password,
      channelPlatform: channel.channelPlatform,
      channelName: channel.channelName,
      channelUrl: channel.channelUrl
    });
  } catch (error) {
    setText(els.authMessage, authErrorMessage(error));
    return;
  }

  if (signupResult?.data?.emailConfirmationRequired !== true) {
    setText(els.authMessage, "회원가입 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  setAuthMode("login");
  setText(els.authMessage, "확인 메일을 보냈습니다. 메일의 링크로 인증한 뒤 로그인해 주세요.");
}

async function sendPasswordResetEmail() {
  if (!state.supabase) {
    setText(els.authMessage, "계정 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  const email = els.email?.value.trim();
  if (!email) {
    setText(els.authMessage, "비밀번호를 재설정할 이메일을 입력해 주세요.");
    els.email?.focus();
    return;
  }

  setText(els.authMessage, "비밀번호 재설정 메일을 보내는 중입니다.");
  const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  setText(els.authMessage, error ? error.message : "비밀번호 재설정 메일을 보냈습니다. 메일함의 링크를 열어 새 비밀번호를 저장하세요.");
}

async function updatePassword() {
  if (!state.supabase) {
    setText(els.authMessage, "계정 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  const password = els.password?.value || "";
  if (password.length < 6) {
    setText(els.authMessage, "새 비밀번호는 6자 이상이어야 합니다.");
    els.password?.focus();
    return;
  }

  setText(els.authMessage, "새 비밀번호를 저장하는 중입니다.");
  const { error } = await state.supabase.auth.updateUser({ password });
  if (error) {
    setText(els.authMessage, error.message);
    return;
  }

  setPasswordRecoveryMode(false);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  setText(els.authMessage, "비밀번호가 변경되었습니다.");
  renderSession();
}

async function signOut() {
  await fetch("/api/admin-session", { method: "DELETE" }).catch(() => {});
  await state.supabase.auth.signOut();
  setText(els.authMessage, "로그아웃되었습니다.");
}

function renderSession() {
  const user = state.session?.user;
  const profilePage = isProfilePage();

  if (!state.authReady && profilePage) {
    return;
  }

  if (state.passwordRecovery) {
    els.profileSection?.classList.add("is-hidden");
    setText(els.headerAccount, "비밀번호 재설정");
    if (els.navAccount) {
      els.navAccount.href = "/login.html";
    }
    openLoginDialog();
    return;
  }
  if (!user) {
    els.profileSection?.classList.add("is-hidden");
    els.profileCard?.classList.remove("is-hidden");
    els.dashboardContent?.classList.remove("is-hidden");
    setText(els.headerAccount, "로그인");
    if (els.navAccount) {
      els.navAccount.href = "/login.html";
    }
    if (els.headerAdmin) {
      els.headerAdmin.style.display = "none";
    }
    state.account = null;
    setText(
      els.dashboardMessage,
      profilePage ? "로그인이 필요합니다. 상단의 로그인 버튼을 눌러 다시 로그인해 주세요." : "계정의 라이선스, 사용 제한, 공유 코드, 등록 PC를 확인합니다."
    );
    clearAccountDashboard();
    if (!profilePage) {
      handleAccountHash();
    }
    return;
  }
  if (isLoginPage()) {
    // 복원된 세션은 역할 목적지로 — 시청자 마커면 /me, 그 외 /profile.html
    // (navigateToProfile이 마커를 읽는다). 역할 무관 /profile.html 강제 이동이
    // 시청자를 스트리머 계정 페이지로 던지던 버그의 수정. 스트리머 로그인은
    // signIn/signUp이 마커를 "streamer"로 갱신하므로 기존 흐름 그대로다.
    navigateToProfile();
    return;
  }
  els.profileSection?.classList.remove("is-hidden");
  els.profileCard?.classList.remove("is-hidden");
  els.dashboardContent?.classList.remove("is-hidden");
  setText(els.headerAccount, "내 프로필");
  if (els.navAccount) {
    els.navAccount.href = profileDestination();
  }
  setText(els.dashboardMessage, "계정의 라이선스, 사용 제한, 공유 코드, 등록 PC를 확인합니다.");
  setText(els.userEmail, user.email || user.id);
  setText(els.profileInitial, getProfileInitial(user.email || user.id));
  closeLoginDialog();
  clearLoginHash();

  if (state.pendingProfileNavigation && !profilePage) {
    navigateToProfile();
    return;
  }

  if (profilePage) {
    void enterProfilePage();
  }
}

// /profile.html(계정 센터) 진입 가드 — 시청자 마커 세션은 streamer 역할이 없으면
// /me로 보낸다(즐겨찾기·구버전 링크·직접 URL 진입 방어). 겸직 계정(roles에
// streamer 포함)은 계정 센터를 그대로 쓰고, 역할 조회 실패 시에도 그대로 둔다.
async function enterProfilePage() {
  if (readLastLoginRole() === "viewer") {
    const token = state.session?.access_token;
    try {
      const result = token ? await getJsonWithAuth("/api/me/profile", token) : null;
      const roles = Array.isArray(result?.data?.roles) ? result.data.roles : [];
      if (!roles.includes("streamer")) {
        window.location.replace("/me");
        return;
      }
    } catch {
      // 역할 확인 실패 — 오탐 리다이렉트 대신 계정 센터를 유지한다
    }
  }
  void loadAccount();
}

function isPasswordRecoveryUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
}

function setPasswordRecoveryMode(enabled) {
  setAuthMode(enabled ? "recovery" : "login");
  if (els.password) {
    els.password.value = "";
  }
  if (enabled) {
    openLoginDialog();
    els.password?.focus();
    setText(els.authMessage, "새 비밀번호를 입력하고 저장하세요.");
  }
}

async function loadAccount() {
  const token = state.session?.access_token;
  if (!token) {
    return;
  }
  try {
    const result = await getJsonWithAuth("/api/account", token);
    state.account = result.data;
    renderAccount(result.data);
  } catch (error) {
    setText(els.licensePlan, "확인 실패");
    setText(els.licenseStatus, error instanceof Error ? error.message : "계정 정보를 불러오지 못했습니다.");
  }
}

function renderAccount(account) {
  const profile = account.profile || {};
  const license = account.activeLicense;
  renderProfileChannel(profile);
  setText(els.accountRole, `역할: ${roleLabel(profile.role)}`);
  els.adminLicensePanel?.classList.toggle("is-hidden", profile.role !== "admin");
  if (els.headerAdmin) {
    els.headerAdmin.style.display = (profile.role === "admin") ? "inline-flex" : "none";
  }

  if (!license) {
    setText(els.licensePlan, "무료 체험 대기");
    setText(els.licenseStatus, "프로그램을 다운로드한 뒤 첫 로그인하면 2일 무료 체험이 자동으로 시작됩니다.");
    setText(els.licenseCode, "첫 프로그램 로그인 대기");
    replaceRows(els.licenseLimits, [row("무료 체험", "계정당 1회 · 첫 프로그램 로그인 기준 2일")]);
  } else {
    setText(els.licensePlan, planLabel(license.plan));
    setText(els.licenseStatus, `${statusLabel(effectiveLicenseStatus(license))} · ${license.expires_at ? `${formatDateTime(license.expires_at)}까지` : "만료일 없음"}`);
    setText(els.licenseCode, license.license_code || "-");
    replaceRows(els.licenseLimits, [
      row("시그니처", `${license.max_signatures}개`),
      row("미디어", `${license.max_media_mb}MB`),
      row("등록 PC", `${license.max_devices}대`),
      row("공유 코드", license.shared_sync_enabled ? "사용 가능" : "미포함"),
      row("사용 기능", featureFlagsLabel(license.feature_flags))
    ]);
  }

  replaceRows(
    els.sharedCodeList,
    account.sharedCodes?.length
      ? account.sharedCodes.map((item) => row(item.code, sharedRoleLabel(item.role)))
      : [emptyRow("아직 연결된 공유 코드가 없습니다.")]
  );

  replaceRows(
    els.deviceList,
    account.devices?.length
      ? account.devices.map((item) => row(item.device_name || "이름 없는 PC", item.app_version || formatDate(item.last_seen_at)))
      : [emptyRow("아직 등록된 PC가 없습니다.")]
  );

  replaceRows(
    els.downloadList,
    account.downloads?.length
      ? account.downloads.map((item) => row(item.release_tag, formatDate(item.created_at)))
      : [emptyRow("다운로드 기록이 없습니다.")]
  );
}

function clearAccountDashboard() {
  setText(els.userEmail, "-");
  setText(els.profileInitial, "G");
  setText(els.accountRole, "");
  setText(els.licensePlan, "-");
  if (els.headerAdmin) {
    els.headerAdmin.style.display = "none";
  }
  setText(els.licenseStatus, "");
  setText(els.licenseCode, "-");
  replaceRows(els.licenseLimits, []);
  replaceRows(els.sharedCodeList, []);
  replaceRows(els.deviceList, []);
  replaceRows(els.downloadList, []);
  renderProfileChannel({});
  els.adminLicensePanel?.classList.add("is-hidden");
  setText(els.adminLicenseMessage, "");
  replaceRows(els.adminLicenseResult, []);
  state.adminDeviceTargetEmail = null;
  setText(els.adminDeviceMessage, "");
  replaceRows(els.adminDeviceResult, []);
  if (els.adminDeviceClearAll) {
    els.adminDeviceClearAll.disabled = true;
  }
  setText(els.redeemCodeMessage, "");
  replaceRows(els.redeemCodeResult, []);
  setText(els.adminCodeMessage, "");
  replaceRows(els.adminCodeResult, []);
  setAdminLicenseTarget(null);
  setFeatureCheckboxes("admin-license-feature", defaultFeatureFlags);
  setFeatureCheckboxes("admin-code-feature", defaultFeatureFlags);
}

function renderProfileChannel(profile) {
  const platform = profile.channel_platform || "youtube";
  const name = profile.channel_name || "";
  const url = profile.channel_url || "";
  if (els.profileChannelPlatform) {
    els.profileChannelPlatform.value = platform;
  }
  if (els.profileChannelName) {
    els.profileChannelName.value = name;
  }
  if (els.profileChannelUrl) {
    els.profileChannelUrl.value = url;
  }
  const summary = name ? `${channelPlatformLabel(platform)} · ${name}${url ? ` · ${url}` : ""}` : "채널 정보를 입력하면 관리자 패널에서 바로 확인할 수 있습니다.";
  setText(els.profileChannelSummary, summary);
  setText(els.profileChannelMessage, "");
}

async function saveProfileChannel() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.profileChannelMessage, "로그인이 필요합니다.");
    return;
  }
  setText(els.profileChannelMessage, "채널 정보를 저장하는 중입니다.");
  try {
    const result = await patchJsonWithAuth("/api/account", token, readChannelInput("profile"));
    state.account = { ...(state.account || {}), profile: result.data.profile };
    renderProfileChannel(result.data.profile || {});
    setText(els.profileChannelMessage, "채널 정보가 저장되었습니다.");
  } catch (error) {
    setText(els.profileChannelMessage, error instanceof Error ? error.message : "채널 정보를 저장하지 못했습니다.");
  }
}

async function deleteAccount() {
  const token = state.session?.access_token;
  const confirmation = els.accountDeleteConfirm?.value.trim() || "";
  if (!token) {
    setText(els.accountDeleteMessage, "로그인이 필요합니다.");
    return;
  }
  if (confirmation !== "계정 탈퇴") {
    setText(els.accountDeleteMessage, "확인 문구로 '계정 탈퇴'를 정확히 입력해 주세요.");
    els.accountDeleteConfirm?.focus();
    return;
  }
  const agreed = window.confirm("정말 계정을 탈퇴할까요? 계정, 라이선스, 등록 PC, 공유 코드 연결 정보가 삭제되며 되돌릴 수 없습니다.");
  if (!agreed) {
    setText(els.accountDeleteMessage, "계정 탈퇴를 취소했습니다.");
    return;
  }

  if (els.accountDeleteButton) {
    els.accountDeleteButton.disabled = true;
  }
  setText(els.accountDeleteMessage, "계정을 탈퇴 처리하는 중입니다.");
  try {
    await deleteJsonWithAuth("/api/account", token, { confirmation });
    await state.supabase?.auth.signOut();
    state.session = null;
    state.account = null;
    window.location.href = "/index.html";
  } catch (error) {
    setText(els.accountDeleteMessage, error instanceof Error ? error.message : "계정 탈퇴에 실패했습니다.");
    if (els.accountDeleteButton) {
      els.accountDeleteButton.disabled = confirmation !== "계정 탈퇴";
    }
  }
}

function readChannelInput(source) {
  const platformEl = source === "profile" ? els.profileChannelPlatform : els.signupChannelPlatform;
  const nameEl = source === "profile" ? els.profileChannelName : els.signupChannelName;
  const urlEl = source === "profile" ? els.profileChannelUrl : els.signupChannelUrl;
  return {
    channelPlatform: platformEl?.value || "youtube",
    channelName: nameEl?.value.trim() || "",
    channelUrl: urlEl?.value.trim() || ""
  };
}

function channelPlatformLabel(value) {
  if (value === "instagram") {
    return "Instagram";
  }
  if (value === "tiktok") {
    return "TikTok";
  }
  return "YouTube";
}

async function redeemLicenseCode() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.redeemCodeMessage, "로그인이 필요합니다.");
    return;
  }
  const code = els.redeemCodeInput?.value.trim();
  if (!code) {
    setText(els.redeemCodeMessage, "등록할 코드를 입력해 주세요.");
    return;
  }

  setText(els.redeemCodeMessage, "코드를 등록하는 중입니다.");
  replaceRows(els.redeemCodeResult, []);

  try {
    const result = await postJsonWithAuth("/api/license-code", token, { code });
    const license = result.data.license;
    setText(els.redeemCodeMessage, "코드가 등록되었습니다.");
    replaceRows(els.redeemCodeResult, [
      row("요금제", planLabel(license.plan)),
      row("상태", statusLabel(license.status)),
      row("만료일", license.expires_at ? formatDateTime(license.expires_at) : "만료일 없음"),
      row("라이선스 코드", license.license_code)
    ]);
    if (els.redeemCodeInput) {
      els.redeemCodeInput.value = "";
    }
    await loadAccount();
  } catch (error) {
    setText(els.redeemCodeMessage, error instanceof Error ? error.message : "코드 등록에 실패했습니다.");
  }
}

async function createAdminLicense() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.adminLicenseMessage, "관리자 로그인이 필요합니다.");
    return;
  }

  const email = els.adminLicenseEmail?.value.trim();
  if (!email) {
    setText(els.adminLicenseMessage, "사용자 이메일을 입력해 주세요.");
    return;
  }

  setText(els.adminLicenseMessage, "라이선스를 발급하는 중입니다.");
  replaceRows(els.adminLicenseResult, []);

  try {
    const quotaAdditions = readAdminQuotaAdditions();
    const result = await postJsonWithAuth("/api/admin-license", token, {
      email,
      plan: els.adminLicensePlan?.value || "starter",
      status: els.adminLicenseStatus?.value || "active",
      expiresAt: els.adminLicenseExpires?.value || undefined,
      notes: els.adminLicenseNotes?.value.trim() || undefined,
      featureFlags: readFeatureFlags("admin-license-feature"),
      ...quotaAdditions
    });
    const license = result.data.license;
    setText(els.adminLicenseMessage, "라이선스가 발급되었습니다.");
    setAdminLicenseTarget(license);
    clearAdminQuotaAdditions();
    replaceRows(els.adminLicenseResult, [
      row("사용자", email),
      row("요금제", planLabel(license.plan)),
      row("상태", statusLabel(license.status)),
      row("사용 기능", featureFlagsLabel(license.feature_flags)),
      row("사용 제한", licenseLimitLabel(license)),
      row("라이선스 코드", license.license_code)
    ]);
    if (state.session?.user?.email?.toLowerCase() === email.toLowerCase()) {
      await loadAccount();
    }
  } catch (error) {
    setText(els.adminLicenseMessage, error instanceof Error ? error.message : "라이선스 발급에 실패했습니다.");
  }
}

async function createAdminCode() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.adminCodeMessage, "관리자 로그인이 필요합니다.");
    return;
  }

  setText(els.adminCodeMessage, "이용권 코드를 발급하는 중입니다.");
  replaceRows(els.adminCodeResult, []);

  try {
    const result = await postJsonWithAuth("/api/admin-license-code", token, {
      mode: els.adminCodeMode?.value || "account",
      plan: els.adminCodePlan?.value || "starter",
      durationUnit: els.adminCodeDurationUnit?.value || "day",
      durationValue: els.adminCodeDurationValue?.value || "1",
      maxRedemptions: els.adminCodeMaxRedemptions?.value || "1",
      validUntil: els.adminCodeValidUntil?.value || undefined,
      notes: els.adminCodeNotes?.value.trim() || undefined,
      featureFlags: readFeatureFlags("admin-code-feature")
    });
    const codeInfo = result.data.codeInfo;
    setText(els.adminCodeMessage, "이용권 코드가 발급되었습니다. 원본 코드는 지금만 표시됩니다.");
    replaceRows(els.adminCodeResult, [
      row("발급 코드", result.data.code),
      row("요금제", planLabel(codeInfo.plan)),
      row("기간", durationLabel(codeInfo.duration_hours)),
      row("사용 기능", featureFlagsLabel(codeInfo.feature_flags)),
      row("사용 가능 횟수", `${codeInfo.max_redemptions}회`)
    ]);
  } catch (error) {
    setText(els.adminCodeMessage, error instanceof Error ? error.message : "이용권 코드 발급에 실패했습니다.");
  }
}

async function lookupAdminLicenses() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.adminLicenseMessage, "관리자 로그인이 필요합니다.");
    return;
  }

  const email = els.adminLicenseEmail?.value.trim();
  if (!email) {
    setText(els.adminLicenseMessage, "조회할 사용자 이메일을 입력해 주세요.");
    return;
  }

  setText(els.adminLicenseMessage, "사용자 라이선스를 조회하는 중입니다.");
  replaceRows(els.adminLicenseResult, []);
  setAdminLicenseTarget(null);

  try {
    const result = await getJsonWithAuth(`/api/admin-license?email=${encodeURIComponent(email)}`, token);
    const { profile, licenses, activeLicense } = result.data;
    const target = activeLicense || licenses?.[0] || null;
    setAdminLicenseTarget(target);
    if (target) {
      fillAdminLicenseForm(target);
    }
    setText(els.adminLicenseMessage, target ? "라이선스를 조회했습니다. 값을 바꾼 뒤 수정할 수 있습니다." : "가입 계정은 있지만 라이선스가 없습니다.");
    renderAdminLicenseLookup(profile, licenses || []);
    await lookupAdminDevices({ quiet: true });
  } catch (error) {
    setText(els.adminLicenseMessage, error instanceof Error ? error.message : "사용자 조회에 실패했습니다.");
  }
}

async function updateAdminLicense() {
  const token = state.session?.access_token;
  const target = state.adminLicenseTarget;
  if (!token) {
    setText(els.adminLicenseMessage, "관리자 로그인이 필요합니다.");
    return;
  }
  if (!target) {
    setText(els.adminLicenseMessage, "먼저 사용자 조회로 수정할 라이선스를 선택해 주세요.");
    return;
  }

  setText(els.adminLicenseMessage, "기존 라이선스를 수정하는 중입니다.");
  try {
    const quotaAdditions = readAdminQuotaAdditions();
    const result = await patchJsonWithAuth("/api/admin-license", token, {
      licenseId: target.id,
      plan: els.adminLicensePlan?.value || target.plan,
      status: els.adminLicenseStatus?.value || target.status,
      expiresAt: els.adminLicenseExpires?.value || undefined,
      notes: els.adminLicenseNotes?.value.trim() || undefined,
      featureFlags: readFeatureFlags("admin-license-feature"),
      ...quotaAdditions
    });
    const license = result.data.license;
    setAdminLicenseTarget(license);
    setText(els.adminLicenseMessage, "기존 라이선스가 수정되었습니다.");
    clearAdminQuotaAdditions();
    replaceRows(els.adminLicenseResult, [
      row("라이선스 코드", license.license_code),
      row("요금제", planLabel(license.plan)),
      row("상태", statusLabel(license.status)),
      row("사용 기능", featureFlagsLabel(license.feature_flags)),
      row("제한", licenseLimitLabel(license))
    ]);
    if (state.session?.user?.id === license.user_id) {
      await loadAccount();
    }
  } catch (error) {
    setText(els.adminLicenseMessage, error instanceof Error ? error.message : "라이선스 수정에 실패했습니다.");
  }
}

function setAdminLicenseTarget(license) {
  state.adminLicenseTarget = license;
  if (els.adminLicenseUpdate) {
    els.adminLicenseUpdate.disabled = !license;
  }
}

function fillAdminLicenseForm(license) {
  if (els.adminLicensePlan) {
    els.adminLicensePlan.value = license.plan || "starter";
  }
  if (els.adminLicenseStatus) {
    els.adminLicenseStatus.value = license.status || "active";
  }
  if (els.adminLicenseExpires) {
    els.adminLicenseExpires.value = dateInputValue(license.expires_at);
  }
  if (els.adminLicenseNotes) {
    els.adminLicenseNotes.value = license.notes || "";
  }
  clearAdminQuotaAdditions();
  setFeatureCheckboxes("admin-license-feature", license.feature_flags);
}

function readAdminQuotaAdditions() {
  const addSignatures = readNonNegativeIntegerInput(els.adminLicenseAddSignatures, "시그니처 추가 수");
  const addMediaMb = readNonNegativeIntegerInput(els.adminLicenseAddMediaMb, "미디어 추가 MB");
  return {
    ...(addSignatures ? { addSignatures } : {}),
    ...(addMediaMb ? { addMediaMb } : {})
  };
}

function readNonNegativeIntegerInput(input, label) {
  if (!(input instanceof HTMLInputElement)) {
    return undefined;
  }
  const raw = input.value.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) {
    throw new Error(`${label}는 0 이상 1,000,000 이하의 정수로 입력해 주세요.`);
  }
  return value;
}

function clearAdminQuotaAdditions() {
  if (els.adminLicenseAddSignatures) {
    els.adminLicenseAddSignatures.value = "";
  }
  if (els.adminLicenseAddMediaMb) {
    els.adminLicenseAddMediaMb.value = "";
  }
}

function licenseLimitLabel(license) {
  return `${license?.max_signatures ?? 0}개 / ${license?.max_media_mb ?? 0}MB / ${license?.max_devices ?? 1}대`;
}

function renderAdminLicenseLookup(profile, licenses) {
  const rows = [
    row("사용자", profile.email || profile.user_id),
    row("권한", roleLabel(profile.role)),
    row("라이선스 수", `${licenses.length}개`)
  ];
  if (!licenses.length) {
    rows.push(emptyRow("발급된 라이선스가 없습니다. 새 라이선스 발급을 사용할 수 있습니다."));
  } else {
    rows.push(
      ...licenses
        .slice(0, 5)
        .map((license) =>
          row(
            license.license_code,
            `${planLabel(license.plan)} · ${statusLabel(license.status)} · ${licenseLimitLabel(license)} · ${featureFlagsLabel(license.feature_flags)}`
          )
        )
    );
  }
  replaceRows(els.adminLicenseResult, rows);
}

async function lookupAdminDevices(options = {}) {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.adminDeviceMessage, "관리자 로그인이 필요합니다.");
    return;
  }

  const email = els.adminLicenseEmail?.value.trim();
  if (!email) {
    setText(els.adminDeviceMessage, "조회할 사용자 이메일을 입력해 주세요.");
    return;
  }

  if (!options.quiet) {
    setText(els.adminDeviceMessage, "등록 PC를 조회하는 중입니다.");
  }
  replaceRows(els.adminDeviceResult, []);
  if (els.adminDeviceClearAll) {
    els.adminDeviceClearAll.disabled = true;
  }

  try {
    const result = await getJsonWithAuth(`/api/admin-devices?email=${encodeURIComponent(email)}`, token);
    state.adminDeviceTargetEmail = email;
    renderAdminDevices(result.data);
    setText(
      els.adminDeviceMessage,
      result.data.devices?.length ? `등록 PC ${result.data.devices.length}대를 조회했습니다.` : "등록된 PC가 없습니다."
    );
  } catch (error) {
    setText(els.adminDeviceMessage, error instanceof Error ? error.message : "등록 PC 조회에 실패했습니다.");
  }
}

async function deleteAdminDevice(deviceId) {
  const token = state.session?.access_token;
  if (!token || !deviceId) {
    setText(els.adminDeviceMessage, "해제할 PC를 선택해 주세요.");
    return;
  }
  if (!window.confirm("선택한 PC 등록을 해제할까요?")) {
    return;
  }

  setText(els.adminDeviceMessage, "PC 등록을 해제하는 중입니다.");
  try {
    await deleteJsonWithAuth("/api/admin-devices", token, { deviceId });
    setText(els.adminDeviceMessage, "PC 등록을 해제했습니다.");
    await lookupAdminDevices({ quiet: true });
    if (state.session?.user?.email?.toLowerCase() === state.adminDeviceTargetEmail?.toLowerCase()) {
      await loadAccount();
    }
  } catch (error) {
    setText(els.adminDeviceMessage, error instanceof Error ? error.message : "PC 등록 해제에 실패했습니다.");
  }
}

async function clearAllAdminDevices() {
  const token = state.session?.access_token;
  const email = state.adminDeviceTargetEmail || els.adminLicenseEmail?.value.trim();
  if (!token || !email) {
    setText(els.adminDeviceMessage, "먼저 사용자 이메일로 등록 PC를 조회해 주세요.");
    return;
  }
  if (!window.confirm(`${email} 계정의 등록 PC를 모두 해제할까요?`)) {
    return;
  }

  setText(els.adminDeviceMessage, "전체 PC 등록을 해제하는 중입니다.");
  try {
    const result = await deleteJsonWithAuth("/api/admin-devices", token, { email, all: true });
    setText(els.adminDeviceMessage, `PC 등록 ${result.data.deletedCount}개를 해제했습니다.`);
    await lookupAdminDevices({ quiet: true });
    if (state.session?.user?.email?.toLowerCase() === email.toLowerCase()) {
      await loadAccount();
    }
  } catch (error) {
    setText(els.adminDeviceMessage, error instanceof Error ? error.message : "전체 PC 해제에 실패했습니다.");
  }
}

function renderAdminDevices(data) {
  const devices = data.devices || [];
  if (els.adminDeviceClearAll) {
    els.adminDeviceClearAll.disabled = devices.length === 0;
  }
  if (!devices.length) {
    replaceRows(els.adminDeviceResult, [emptyRow("등록된 PC가 없습니다.")]);
    return;
  }
  replaceRows(
    els.adminDeviceResult,
    devices.map((device) => adminDeviceRow(device))
  );
}

function adminDeviceRow(device) {
  const item = document.createElement("li");
  item.className = "admin-device-row";

  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const detail = document.createElement("small");
  name.textContent = device.deviceName || "이름 없는 PC";
  detail.textContent = [
    device.license ? `${planLabel(device.license.plan)} · ${statusLabel(device.license.status)}` : "라이선스 정보 없음",
    device.appVersion ? `앱 ${device.appVersion}` : "",
    device.lastSeenAt ? `마지막 접속 ${formatDateTime(device.lastSeenAt)}` : "",
    device.fingerprintSuffix ? `ID ${device.fingerprintSuffix}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
  copy.append(name, detail);

  const button = document.createElement("button");
  button.className = "button secondary compact-button";
  button.type = "button";
  button.dataset.adminDeviceDelete = device.id;
  button.textContent = "PC 해제";
  item.append(copy, button);
  return item;
}

function syncAdminCodeDurationField() {
  const isUnlimited = els.adminCodeDurationUnit?.value === "unlimited";
  if (els.adminCodeDurationValue) {
    els.adminCodeDurationValue.disabled = isUnlimited;
    els.adminCodeDurationValue.required = !isUnlimited;
  }
}

async function logDownload(release) {
  const token = state.session?.access_token;
  const asset = release.downloadAsset || {};
  try {
    await fetch("/api/download-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        releaseTag: release.tagName,
        assetName: asset.name || "source-zip",
        assetUrl: release.downloadUrl
      })
    });
  } catch {
    // Download logging should never block the user.
  }
}

async function getJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function apiJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getJsonWithAuth(url, token) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function postJsonWithAuth(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function patchJsonWithAuth(url, token, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function deleteJsonWithAuth(url, token, body) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function replaceRows(target, rows) {
  if (!target) {
    return;
  }
  target.replaceChildren(...rows);
}

function row(label, value) {
  const item = document.createElement("li");
  const labelEl = document.createElement("span");
  const valueEl = document.createElement("strong");
  labelEl.textContent = label;
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  return item;
}

function emptyRow(value) {
  const item = document.createElement("div");
  item.className = "account-empty";
  item.textContent = value;
  return item;
}

function roleLabel(value) {
  if (value === "admin") {
    return "관리자";
  }
  return "사용자";
}

function normalizeFeatureFlags(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(featureKeys.map((key) => [key, typeof source[key] === "boolean" ? source[key] : defaultFeatureFlags[key]]));
}

function readFeatureFlags(className) {
  const flags = { ...defaultFeatureFlags };
  document.querySelectorAll(`.${className}`).forEach((input) => {
    if (input instanceof HTMLInputElement && featureKeys.includes(input.value)) {
      flags[input.value] = input.checked;
    }
  });
  return flags;
}

function setFeatureCheckboxes(className, flagsInput) {
  const flags = normalizeFeatureFlags(flagsInput);
  document.querySelectorAll(`.${className}`).forEach((input) => {
    if (input instanceof HTMLInputElement && featureKeys.includes(input.value)) {
      input.checked = flags[input.value] !== false;
    }
  });
}

function featureFlagsLabel(flagsInput) {
  const flags = normalizeFeatureFlags(flagsInput);
  const enabled = featureKeys.filter((key) => flags[key]).map((key) => featureLabels[key]);
  return enabled.length === featureKeys.length ? "전체 사용" : enabled.length ? enabled.join(", ") : "전부 잠금";
}

function planLabel(value) {
  const labels = {
    owner: "관리자",
    starter: "Starter",
    standard: "Standard",
    pro: "Pro"
  };
  return labels[value] || "알 수 없음";
}

function statusLabel(value) {
  const labels = {
    pending: "대기",
    inactive: "비활성 · 결제 필요",
    active: "활성",
    expired: "만료",
    suspended: "정지"
  };
  return labels[value] || "상태 확인 필요";
}

function sharedRoleLabel(value) {
  const labels = {
    owner: "소유자",
    editor: "편집자",
    viewer: "보기"
  };
  return labels[value] || "보기";
}

function getProfileInitial(value) {
  const trimmed = String(value || "G").trim();
  return (trimmed.charAt(0) || "G").toUpperCase();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function effectiveLicenseStatus(license) {
  if (license?.status === "active" && license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return "expired";
  }
  return license?.status;
}

function dateInputValue(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function durationLabel(hours) {
  if (hours === null || hours === undefined) {
    return "무기한";
  }
  if (hours % 24 === 0) {
    return `${hours / 24}일`;
  }
  return `${hours}시간`;
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "크기 정보 없음";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

// ==========================================================================
// Interactive Motion Graphics for Main Page (Gyeideuk Redesign)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initBgParticleCanvas();
  initHero3DTilt();
  initFlowSimulationLoop();
  initFeatureMockupTabs();
  initSetupPhoneTabs();
});

// 1. Interactive Luminous Particle Canvas System
function initBgParticleCanvas() {
  const canvas = document.getElementById("bg-particle-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let particles = [];
  let mouse = { x: null, y: null, radius: 150 };

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener("mouseleave", () => {
    mouse.x = null;
    mouse.y = null;
  });

  class Particle {
    constructor() {
      this.reset();
      this.y = Math.random() * canvas.height;
    }

    reset() {
      this.x = Math.random() * canvas.width;
      this.y = canvas.height + 20;
      this.size = Math.random() * 2.5 + 0.8;
      this.speedX = Math.random() * 0.3 - 0.15;
      this.speedY = -(Math.random() * 0.7 + 0.2);
      this.color = Math.random() > 0.45 ? "rgba(99, 102, 241, 0.12)" : "rgba(139, 92, 246, 0.12)";
      this.baseX = this.x;
      this.baseY = this.y;
      this.density = (Math.random() * 25) + 8;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;

      if (mouse.x !== null && mouse.y !== null) {
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < mouse.radius) {
          let forceDirectionX = dx / distance;
          let forceDirectionY = dy / distance;
          let maxDistance = mouse.radius;
          let force = (maxDistance - distance) / maxDistance;
          let directionX = forceDirectionX * force * this.density * 0.5;
          let directionY = forceDirectionY * force * this.density * 0.5;
          this.x -= directionX;
          this.y -= directionY;
        }
      }

      if (this.y < -20 || this.x < -20 || this.x > canvas.width + 20) {
        this.reset();
      }
    }

    draw() {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  const particleCount = Math.min(35, Math.floor((canvas.width * canvas.height) / 40000));
  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particles.length; i++) {
      particles[i].update();
      particles[i].draw();
    }
    requestAnimationFrame(animate);
  }
  animate();
}

// 2. Hero 3D Mouse Parallax Tilt Effect
function initHero3DTilt() {
  const container = document.querySelector(".hero-motion-graphic");
  if (!container) return;

  container.style.perspective = "1200px";
  const targetElements = container.querySelectorAll(".obs-floating-board, .listener-floating-board, .glow-core");

  container.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((centerY - y) / centerY) * 10;
    const rotateY = ((x - centerX) / centerX) * 10;

    targetElements.forEach((el) => {
      el.style.transition = "transform 0.08s ease-out";
      if (el.classList.contains("obs-floating-board")) {
        el.style.transform = `rotateY(${rotateY - 15}deg) rotateX(${rotateX + 10}deg) translateZ(40px)`;
      } else if (el.classList.contains("listener-floating-board")) {
        el.style.transform = `rotateY(${rotateY + 15}deg) rotateX(${rotateX + 10}deg) translateZ(40px)`;
      } else if (el.classList.contains("glow-core")) {
        el.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg) translateZ(20px)`;
      }
    });
  });

  container.addEventListener("mouseleave", () => {
    targetElements.forEach((el) => {
      el.style.transition = "transform 0.7s cubic-bezier(0.25, 1, 0.5, 1)";
      if (el.classList.contains("obs-floating-board")) {
        el.style.transform = "rotateY(-15deg) rotateX(10deg) translateZ(0px)";
      } else if (el.classList.contains("listener-floating-board")) {
        el.style.transform = "rotateY(15deg) rotateX(10deg) translateZ(0px)";
      } else {
        el.style.transform = "none";
      }
    });
  });
}

// 3. How it Works: Loop Simulation Sequence
function initFlowSimulationLoop() {
  const flowContainer = document.querySelector(".visual-flow-container");
  if (!flowContainer) return;

  const phone = flowContainer.querySelector(".phone-mockup");
  const signalPath = flowContainer.querySelector(".transfer-signal-path");
  const monitor = flowContainer.querySelector(".monitor-mockup");

  const pushAlert = phone ? phone.querySelector(".push-alert") : null;
  const signalPulse = signalPath ? signalPath.querySelector(".signal-pulse") : null;
  const obsAlertBox = monitor ? monitor.querySelector(".obs-alert-box") : null;

  let loopInterval = null;

  // Dynamically add extra sparks if needed
  let particlesContainer = monitor ? monitor.querySelector(".obs-alert-particles") : null;
  if (particlesContainer && particlesContainer.children.length < 6) {
    particlesContainer.innerHTML = "";
    const symbols = ["+", "*", "•", "+", "·", "*"];
    symbols.forEach(sym => {
      const sp = document.createElement("span");
      sp.textContent = sym;
      particlesContainer.appendChild(sp);
    });
  }

  function resetFlowStates() {
    phone?.classList.remove("flow-active");
    signalPath?.classList.remove("flow-active");
    monitor?.classList.remove("flow-active");

    if (pushAlert) {
      pushAlert.style.transition = "none";
      pushAlert.style.transform = "translateY(50px)";
      pushAlert.style.opacity = "0";
    }

    if (signalPulse) {
      signalPulse.style.opacity = "0";
      signalPulse.style.left = "0%";
      signalPulse.style.top = "0%";
    }

    if (obsAlertBox) {
      obsAlertBox.style.transition = "none";
      obsAlertBox.style.transform = "translate(-50%, -50%) scale(0.8)";
      obsAlertBox.style.opacity = "0";
    }
  }

  function runFlowCycle() {
    resetFlowStates();

    // Step 1: 입금 알림 발생 (0.5s)
    setTimeout(() => {
      phone?.classList.add("flow-active");
      if (pushAlert) {
        pushAlert.style.transition = "transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.5s";
        pushAlert.style.transform = "translateY(0)";
        pushAlert.style.opacity = "1";
      }
    }, 500);

    // Step 2: 신호 동기화 이동 (2.5s)
    setTimeout(() => {
      if (pushAlert) {
        pushAlert.style.transition = "transform 0.4s ease-in, opacity 0.4s";
        pushAlert.style.transform = "translateY(-30px)";
        pushAlert.style.opacity = "0";
      }

      signalPath?.classList.add("flow-active");
      if (signalPulse) {
        signalPulse.style.opacity = "1";
        const isMobile = window.innerWidth <= 768;
        signalPulse.animate(
          isMobile ? [
            { top: "0%", opacity: "1" },
            { top: "100%", opacity: "1" }
          ] : [
            { left: "0%", opacity: "1" },
            { left: "100%", opacity: "1" }
          ], {
            duration: 1500,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          fill: "forwards"
        });
      }
    }, 2500);

    // Step 3: OBS 반응 알림 팝업 및 스파크 (4.2s)
    setTimeout(() => {
      if (signalPulse) signalPulse.style.opacity = "0";
      monitor?.classList.add("flow-active");

      if (obsAlertBox) {
        // We need to keep translate(-50%, -50%) together with scale!
        obsAlertBox.style.transition = "transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s";
        obsAlertBox.style.transform = "translate(-50%, -50%) scale(1)";
        obsAlertBox.style.opacity = "1";
      }

      if (particlesContainer) {
        const spanElements = particlesContainer.querySelectorAll("span");
        spanElements.forEach((span, idx) => {
          span.style.animation = "none";
          void span.offsetWidth; // Reflow to reset animation
          span.style.animation = `obsParticleExplode 1.5s ease-out forwards`;
          span.style.animationDelay = `${idx * 0.08}s`;
        });
      }
    }, 4200);
  }

  // Delay starting to avoid initial page layout jumps
  setTimeout(() => {
    runFlowCycle();
    loopInterval = setInterval(runFlowCycle, 7500);
  }, 1000);
}

// 4. Product Features: Interactive Desktop App Mockup Tab controller
function initFeatureMockupTabs() {
  const showcase = document.querySelector(".feature-showcase");
  if (!showcase) return;

  const headerTabs = showcase.querySelectorAll(".db-tab-btn");
  const sidebarLinks = showcase.querySelectorAll(".sidebar-menu-item");
  const panels = showcase.querySelectorAll(".db-panel");

  function switchTab(tabId) {
    // 1. Update header tab buttons
    headerTabs.forEach(btn => {
      if (btn.getAttribute("data-tab") === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 2. Update sidebar menu items
    sidebarLinks.forEach(link => {
      if (link.getAttribute("data-tab") === tabId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    // 3. Update active panel
    panels.forEach(panel => {
      if (panel.getAttribute("data-panel") === tabId) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    });
  }

  // Bind click triggers on header tabs
  headerTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // Bind clicks on sidebar links
  sidebarLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const tabId = link.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // A. Interactive Rules Row Click updating Floating Editor
  const ruleRows = showcase.querySelectorAll(".rules-list-row");
  const editorAmtInput = showcase.querySelector(".rules-editor-bubble input");
  const editorDropzone = showcase.querySelector(".rules-editor-bubble .editor-dropzone");
  const sliderFill = showcase.querySelector(".rules-editor-bubble .editor-slider-fill");
  const sliderHandle = showcase.querySelector(".rules-editor-bubble .editor-slider-handle");

  ruleRows.forEach(row => {
    row.addEventListener("click", () => {
      ruleRows.forEach(r => r.classList.remove("active"));
      row.classList.add("active");

      const amt = row.getAttribute("data-amount");
      const filename = row.getAttribute("data-file");
      const vol = row.getAttribute("data-vol");

      if (editorAmtInput) editorAmtInput.value = amt || "";
      if (editorDropzone) editorDropzone.textContent = filename ? `${filename} (클릭하여 교체)` : "미디어 등록";
      if (sliderFill) sliderFill.style.width = vol ? `${vol}%` : "0%";
      if (sliderHandle) sliderHandle.style.left = vol ? `${vol}%` : "0%";
    });
  });

  // B. Media Categories Filter
  const mediaCatPills = showcase.querySelectorAll(".media-cat-pill");
  const mediaCards = showcase.querySelectorAll(".showcase-media-card");

  mediaCatPills.forEach(pill => {
    pill.addEventListener("click", () => {
      mediaCatPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      const type = pill.getAttribute("data-media-type");
      mediaCards.forEach(card => {
        if (type === "all" || card.getAttribute("data-media-type") === type) {
          card.style.display = "flex";
        } else {
          card.style.display = "none";
        }
      });
    });
  });

  // C. Share Code Copy Button Feedback
  const copyBtn = showcase.querySelector(".sync-left-col button.mock-btn-sm");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "복사 완료!";
      copyBtn.style.backgroundColor = "#22c55e";
      copyBtn.style.color = "#fff";
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = "";
        copyBtn.style.color = "";
      }, 1500);
    });
  }
}

// 5. Android Setup Mobile Tutorial tab controller
function initSetupPhoneTabs() {
  const simulator = document.querySelector(".setup-mobile-simulator");
  if (!simulator) return;

  const stepButtons = simulator.querySelectorAll(".setup-steps-list .setup-step-trigger");
  const phone = simulator.querySelector(".setup-phone-mockup");
  if (!phone) return;

  const screens = phone.querySelectorAll(".phone-screen-content .phone-android-screen");

  function switchSetupStep(stepId) {
    // 1. Update step trigger buttons state
    stepButtons.forEach(btn => {
      if (btn.getAttribute("data-setup-step") === stepId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 2. Update visible screen in phone mockup
    screens.forEach(screen => {
      if (screen.getAttribute("data-screen-step") === stepId) {
        screen.classList.add("active");
      } else {
        screen.classList.remove("active");
      }
    });
  }

  // Bind clicks on step buttons
  stepButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const stepId = btn.getAttribute("data-setup-step");
      switchSetupStep(stepId);
    });
  });

  // Allow manual toggle clicks on simulated Android toggle switches
  const toggles = phone.querySelectorAll(".android-toggle");
  toggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("active");
    });
  });
}
