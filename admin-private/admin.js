/**
 * 계이득 (Gyeideuk) Admin Dashboard Controller.
 * Supabase Auth guard, real-time validations, API requests wrapping, and dynamic binding.
 */

(function () {
  'use strict';

  // Global State
  const state = {
    supabase: null,
    session: null,
    authenticatedUserId: "",
    adminVerifiedUserId: "",
    ownerEmails: ["wobuzhi6322@gmail.com", "wlsdyd0323@gmail.com"],
    currentSearchQuery: "",
    currentDeviceTargetEmail: "",
    collapsedFolderCategories: new Set(),
    selectedFolderEmail: "",
    folderLoadRequestId: 0,
    folderProfiles: [],
    selectedFolderUserIds: new Set(),
    webPageLookup: null,
    enterprises: [],
    enterpriseLoadRequestId: 0
  };

  // DOM Elements Selector Cache
  const els = {
    splash: document.getElementById("admin-splash"),
    loginWrapper: document.getElementById("admin-login-wrapper"),
    loginForm: document.getElementById("admin-login-form"),
    loginEmail: document.getElementById("login-email"),
    loginPassword: document.getElementById("login-password"),
    capsLockWarning: document.getElementById("admin-caps-lock-warning"),
    loginError: document.getElementById("login-error-msg"),

    dashboardWrapper: document.getElementById("admin-dashboard-wrapper"),
    userEmailDisplay: document.getElementById("admin-user-email"),
    logoutBtn: document.getElementById("admin-logout-btn"),

    // Tab switching
    tabBtns: document.querySelectorAll(".nav-tab-btn"),
    tabPanels: document.querySelectorAll(".tab-panel"),

    // License Tab Elements
    searchForm: document.getElementById("license-search-form"),
    searchQuery: document.getElementById("search-query"),
    searchFeedback: document.getElementById("search-feedback"),
    userDetailsContainer: document.getElementById("user-details-container"),

    // Profile Fields
    profileRole: document.getElementById("detail-profile-role"),
    profileName: document.getElementById("detail-profile-name"),
    profileEmail: document.getElementById("detail-profile-email"),
    profileChannel: document.getElementById("detail-profile-channel"),
    profileChannelUrl: document.getElementById("detail-profile-channel-url"),
    profileId: document.getElementById("detail-profile-id"),

    // Active License Fields
    activeLicenseDetails: document.getElementById("active-license-details"),
    noActiveLicenseMsg: document.getElementById("no-active-license-msg"),
    licenseId: document.getElementById("detail-license-id"),
    licenseCode: document.getElementById("detail-license-code"),
    licensePlan: document.getElementById("detail-license-plan"),
    licenseSigs: document.getElementById("detail-license-sigs"),
    licenseMedia: document.getElementById("detail-license-media"),
    licenseDevices: document.getElementById("detail-license-devices"),
    licenseExpires: document.getElementById("detail-license-expires"),
    licenseNotes: document.getElementById("detail-license-notes"),

    // License Manage Form
    manageForm: document.getElementById("manage-license-form"),
    formUserId: document.getElementById("form-user-id"),
    formLicenseId: document.getElementById("form-license-id"),
    formPlan: document.getElementById("form-license-plan"),
    formStatus: document.getElementById("form-license-status"),
    formSigs: document.getElementById("form-license-sigs"),
    formMedia: document.getElementById("form-license-media"),
    formExpires: document.getElementById("form-license-expires"),
    flagSharedSync: document.getElementById("flag-shared-sync"),
    formNotes: document.getElementById("form-license-notes"),
    formSubmitBtn: document.getElementById("form-submit-btn"),
    formTitle: document.getElementById("license-form-title"),
    licenseFeedback: document.getElementById("license-action-feedback"),
    licenseHistoryTable: document.getElementById("license-history-table").querySelector("tbody"),
    formProfileName: document.getElementById("form-profile-name"),
    formProfileCategory: document.getElementById("form-profile-category"),
    formProfileNotes: document.getElementById("form-profile-notes"),
    detailProfileCategory: document.getElementById("detail-profile-category"),
    detailProfileNotes: document.getElementById("detail-profile-notes"),
    foldersLoadingMsg: document.getElementById("folders-loading-msg"),
    foldersContainer: document.getElementById("folders-container"),
    btnRefreshFolders: document.getElementById("btn-refresh-folders"),
    folderSelectedCount: document.getElementById("folder-selected-count"),
    folderSelectAllVisible: document.getElementById("folder-select-all-visible"),
    folderSelectionClear: document.getElementById("folder-selection-clear"),
    folderMoveTarget: document.getElementById("folder-move-target"),
    folderMoveBtn: document.getElementById("folder-move-btn"),
    folderCategoryOptions: document.getElementById("folder-category-options"),
    folderBulkLicenseForm: document.getElementById("folder-bulk-license-form"),
    folderBulkLicenseBtn: document.getElementById("folder-bulk-license-btn"),
    folderBulkPlan: document.getElementById("folder-bulk-plan"),
    folderBulkStatus: document.getElementById("folder-bulk-status"),
    folderBulkSigs: document.getElementById("folder-bulk-sigs"),
    folderBulkMedia: document.getElementById("folder-bulk-media"),
    folderBulkExpires: document.getElementById("folder-bulk-expires"),
    folderBulkSharedSync: document.getElementById("folder-bulk-shared-sync"),
    folderBulkMessage: document.getElementById("folder-bulk-message"),
    formChannelPlatform: document.getElementById("form-channel-platform"),
    formChannelName: document.getElementById("form-channel-name"),
    formChannelUrl: document.getElementById("form-channel-url"),
    adminDeviceLookup: document.getElementById("admin-device-lookup"),
    adminDeviceClearAll: document.getElementById("admin-device-clear-all"),
    adminDeviceMessage: document.getElementById("admin-device-message"),
    adminDeviceResult: document.getElementById("admin-device-result"),

    // Web Channel Registration Card
    webPageLookupForm: document.getElementById("web-page-lookup-form"),
    webPageEmail: document.getElementById("web-page-email"),
    webPageLookupBtn: document.getElementById("web-page-lookup-btn"),
    webPageLookupResult: document.getElementById("web-page-lookup-result"),
    webPageForm: document.getElementById("web-page-form"),
    webPageHandle: document.getElementById("web-page-handle"),
    webPageNickname: document.getElementById("web-page-nickname"),
    webPageTeamCode: document.getElementById("web-page-team-code"),
    webPageEnterprise: document.getElementById("web-page-enterprise"),
    webPageDirectoryOptin: document.getElementById("web-page-directory-optin"),
    webPageStatus: document.getElementById("web-page-status"),
    webPageFeedback: document.getElementById("web-page-feedback"),
    webPageSubmitBtn: document.getElementById("web-page-submit-btn"),
    webPageDeleteBtn: document.getElementById("web-page-delete-btn"),

    // Enterprise Management Card
    enterpriseRefreshBtn: document.getElementById("enterprise-refresh-btn"),
    enterpriseCreateForm: document.getElementById("enterprise-create-form"),
    enterpriseName: document.getElementById("enterprise-name"),
    enterpriseSlug: document.getElementById("enterprise-slug"),
    enterpriseCreateBtn: document.getElementById("enterprise-create-btn"),
    enterpriseFeedback: document.getElementById("enterprise-feedback"),
    enterpriseListFeedback: document.getElementById("enterprise-list-feedback"),
    enterpriseTable: document.getElementById("enterprise-table")?.querySelector("tbody"),

    // Code Generator Tab Elements
    codeForm: document.getElementById("create-code-form"),
    codePlan: document.getElementById("code-plan"),
    codeMode: document.getElementById("code-mode"),
    codeDurationUnit: document.getElementById("code-duration-unit"),
    codeDurationValue: document.getElementById("code-duration-value"),
    codeDurationGroup: document.getElementById("code-duration-value-group"),
    codeMaxRedemptions: document.getElementById("code-max-redemptions"),
    codeValidUntil: document.getElementById("code-valid-until"),
    codeFlagSharedSync: document.getElementById("code-flag-shared-sync"),
    codeNotes: document.getElementById("code-notes"),
    codeFeedback: document.getElementById("code-action-feedback"),

    // Code Result Panels
    codeResultPanel: document.getElementById("code-result-panel"),
    resultCodeDisplay: document.getElementById("result-code-display"),
    btnCopyCode: document.getElementById("btn-copy-code"),
    resultCodeBadge: document.getElementById("result-code-badge"),
    resultCodeDuration: document.getElementById("result-code-duration"),
    resultCodeRedemptions: document.getElementById("result-code-redemptions"),

    // Recent Lists
    recentCodesTable: document.getElementById("recent-codes-table").querySelector("tbody"),
    recentRedemptionsTable: document.getElementById("recent-redemptions-table").querySelector("tbody")
  };

  // Helper Labels mapping
  const planLabels = {
    owner: "관리자",
    starter: "Starter",
    standard: "Standard",
    pro: "Pro"
  };

  const statusLabels = {
    active: "활성",
    pending: "대기",
    inactive: "비활성",
    expired: "만료",
    suspended: "정지"
  };

  function channelPlatformLabel(value) {
    if (value === "instagram") return "◎ Instagram";
    if (value === "tiktok") return "♪ TikTok";
    return "▶ YouTube";
  }

  // Initialize Application
  async function init() {
    try {
      // 1. Fetch site configuration to obtain Supabase properties
      const response = await fetch("/api/site-config");
      const configResult = await response.json();

      if (!configResult.ok || !configResult.data?.supabase?.enabled) {
        showGlobalError("데이터베이스 설정이 비활성화되어 있습니다. 서버 환경변수를 확인하세요.");
        return;
      }

      const sbConfig = configResult.data.supabase;

      // 2. Initialize Supabase
      state.supabase = supabase.createClient(sbConfig.url, sbConfig.anonKey);

      // 3. Listen to Auth changes
      state.supabase.auth.onAuthStateChange(async (event, session) => {
        state.session = session;
        if (session?.user) {
          const sameUser = state.authenticatedUserId === session.user.id;
          const alreadyVerified = state.adminVerifiedUserId === session.user.id;
          if (sameUser && alreadyVerified && event !== "SIGNED_IN") {
            refreshAuthenticatedSession(session.user);
            return;
          }
          await verifyAdminUser(session.user, { preserveUi: sameUser });
        } else {
          state.authenticatedUserId = "";
          state.adminVerifiedUserId = "";
          transitionToUnauthenticated();
        }
      });

      // Bind Static Event Listeners
      bindStaticEvents();

    } catch (err) {
      console.error(err);
      showGlobalError("관리자 페이지를 초기화하는 중 오류가 발생했습니다: " + err.message);
    }
  }

  // Verify if the logged-in user is a genuine admin or owner
  async function verifyAdminUser(user, options = {}) {
    try {
      // Owner emails are automatically approved
      const isOwner = state.ownerEmails.includes(user.email?.trim().toLowerCase());

      if (isOwner) {
        state.adminVerifiedUserId = user.id;
        transitionToAuthenticated(user, options);
        return;
      }

      // Else check bbbb_site_profiles role field
      const { data: profile, error } = await state.supabase
        .from("bbbb_site_profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (error || profile?.role !== "admin") {
        alert("접근 권한이 없습니다. 이 계정은 관리자로 승인되지 않았습니다.");
        await fetch("/api/admin-session", { method: "DELETE" }).catch(() => {});
        await state.supabase.auth.signOut();
        transitionToUnauthenticated();
        return;
      }

      state.adminVerifiedUserId = user.id;
      transitionToAuthenticated(user, options);
    } catch (err) {
      console.error(err);
      alert("권한 검증 중 오류가 발생했습니다. 다시 로그인해 주세요.");
      await fetch("/api/admin-session", { method: "DELETE" }).catch(() => {});
      await state.supabase.auth.signOut();
      transitionToUnauthenticated();
    }
  }

  // Transitions
  function transitionToAuthenticated(user, options = {}) {
    const preserveUi = options.preserveUi === true;
    state.authenticatedUserId = user.id;
    if (els.splash) els.splash.style.display = "none";
    if (els.loginWrapper) els.loginWrapper.style.display = "none";
    if (els.dashboardWrapper) els.dashboardWrapper.style.display = "flex";
    if (els.userEmailDisplay) els.userEmailDisplay.textContent = user.email || user.id;

    if (preserveUi) {
      refreshAuthenticatedSession(user);
      return;
    }

    resetSearchState();
    loadFolderStructure();
    loadEnterprises();

    const activeTab = document.querySelector(".nav-tab-btn.active");
    if (activeTab && activeTab.getAttribute("data-tab") === "codes-tab") {
      loadRecentCodes();
    }
  }

  function refreshAuthenticatedSession(user) {
    if (els.splash) els.splash.style.display = "none";
    if (els.loginWrapper) els.loginWrapper.style.display = "none";
    if (els.dashboardWrapper) els.dashboardWrapper.style.display = "flex";
    if (els.userEmailDisplay) els.userEmailDisplay.textContent = user.email || user.id;
    if (!els.foldersContainer?.children?.length) {
      loadFolderStructure();
    }
  }

  function transitionToUnauthenticated() {
    if (els.splash) els.splash.style.display = "none";
    if (els.loginWrapper) els.loginWrapper.style.display = "flex";
    if (els.dashboardWrapper) els.dashboardWrapper.style.display = "none";

    // Reset login form fields
    if (els.loginEmail) els.loginEmail.value = "";
    if (els.loginPassword) els.loginPassword.value = "";
    clearFeedback(els.loginError);
  }

  function showGlobalError(msg) {
    if (els.splash) {
      els.splash.innerHTML = `
        <div class="feedback-msg error" style="max-width: 500px; text-align: center;">
          <h3>珥덇린???ㅽ뙣</h3>
          <p>${escapeHtml(msg)}</p>
        </div>
      `;
    }
  }

  function resetSearchState() {
    state.currentSearchQuery = "";
    state.currentDeviceTargetEmail = "";
    state.selectedFolderEmail = "";
    if (els.searchQuery) els.searchQuery.value = "";
    if (els.userDetailsContainer) els.userDetailsContainer.style.display = "none";
    clearFeedback(els.searchFeedback);
    clearFeedback(els.licenseFeedback);
    resetAdminDevicePanel();
  }

  function setupCapsLockWarning(input, warning) {
    if (!input || !warning) {
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
    input.addEventListener("keydown", updateFromEvent);
    input.addEventListener("keyup", updateFromEvent);
    input.addEventListener("blur", () => setVisible(false));
  }

  // Bind forms & static UI components
  function bindStaticEvents() {
    setupCapsLockWarning(els.loginPassword, els.capsLockWarning);

    // A. Login Form submit handler
    els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFeedback(els.loginError);

      const email = els.loginEmail.value.trim();
      const password = els.loginPassword.value;

      try {
        const { error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) {
          showFeedback(els.loginError, error.message, "error");
        }
      } catch (err) {
        showFeedback(els.loginError, err.message, "error");
      }
    });

    // B. Logout click handler
    els.logoutBtn.addEventListener("click", async () => {
      await fetch("/api/admin-session", { method: "DELETE" }).catch(() => {});
      await state.supabase.auth.signOut();
    });

    // C. Tab navigation switcher
    els.tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");

        els.tabBtns.forEach(b => b.classList.remove("active"));
        els.tabPanels.forEach(p => p.classList.remove("active"));

        btn.classList.add("active");
        document.getElementById(targetTab).classList.add("active");

        if (targetTab === "codes-tab") {
          loadRecentCodes();
        }
      });
    });

    // D. License Search Form submit
    els.searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = els.searchQuery.value.trim();
      if (!query) return;

      state.currentSearchQuery = query;
      await performLicenseLookup(query);
    });

    // E. Quick addition buttons (+3, +10, +50, +50M, etc)
    document.querySelectorAll(".btn-adder").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.getAttribute("data-target");
        const valToAdd = parseInt(button.getAttribute("data-add"), 10);
        const inputEl = document.getElementById(targetId);

        if (inputEl) {
          const currentVal = parseInt(inputEl.value, 10) || 0;
          const newVal = Math.min(1000000, Math.max(0, currentVal + valToAdd));
          inputEl.value = newVal;
        }
      });
    });

    // F. License update/issue Form submit
    els.manageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleLicenseFormSubmit();
    });

    // G. Duration unit selector change
    els.codeDurationUnit.addEventListener("change", () => {
      if (els.codeDurationUnit.value === "unlimited") {
        els.codeDurationGroup.style.display = "none";
      } else {
        els.codeDurationGroup.style.display = "block";
      }
    });

    // H. Code Generator Form submit
    els.codeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleCodeGeneratorSubmit();
    });

    // I. Clipboard copy action
    els.btnCopyCode.addEventListener("click", () => {
      const codeVal = els.resultCodeDisplay.value;
      if (!codeVal) return;

      navigator.clipboard.writeText(codeVal)
        .then(() => {
          const originalText = els.btnCopyCode.textContent;
          els.btnCopyCode.textContent = "복사됨";
          els.btnCopyCode.classList.add("primary");
          setTimeout(() => {
            els.btnCopyCode.textContent = originalText;
            els.btnCopyCode.classList.remove("primary");
          }, 1500);
        })
        .catch(err => {
          console.error(err);
          alert("클립보드 복사에 실패했습니다. 직접 복사해 주세요.");
        });
    });

    // Refresh folders button click
    if (els.btnRefreshFolders) {
      els.btnRefreshFolders.addEventListener("click", () => {
        loadFolderStructure();
      });
    }

    if (els.folderSelectAllVisible) {
      els.folderSelectAllVisible.addEventListener("click", () => {
        selectAllVisibleFolderUsers();
      });
    }

    if (els.folderSelectionClear) {
      els.folderSelectionClear.addEventListener("click", () => {
        clearFolderSelection();
      });
    }

    if (els.folderMoveBtn) {
      els.folderMoveBtn.addEventListener("click", () => {
        moveSelectedFolderUsers();
      });
    }

    if (els.folderBulkLicenseForm) {
      els.folderBulkLicenseForm.addEventListener("submit", (event) => {
        event.preventDefault();
        updateSelectedFolderLicenses();
      });
    }

    if (els.adminDeviceLookup) {
      els.adminDeviceLookup.addEventListener("click", () => {
        lookupAdminDevices();
      });
    }

    if (els.adminDeviceClearAll) {
      els.adminDeviceClearAll.addEventListener("click", () => {
        clearAllAdminDevices();
      });
    }

    if (els.adminDeviceResult) {
      els.adminDeviceResult.addEventListener("click", (event) => {
        const button = event.target.closest("[data-admin-device-delete]");
        if (!button) return;
        deleteAdminDevice(button.dataset.adminDeviceDelete);
      });
    }

    // J. Web channel registration card (admin-driven streamer page)
    if (els.webPageLookupForm) {
      els.webPageLookupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        await lookupWebPageAccount();
      });
    }

    if (els.webPageForm) {
      els.webPageForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        await submitWebPageForm();
      });
    }

    if (els.webPageDeleteBtn) {
      els.webPageDeleteBtn.addEventListener("click", async () => {
        await deleteWebPage();
      });
    }

    // K. Enterprise management card (엔터 생성·이름 수정·목록)
    if (els.enterpriseCreateForm) {
      els.enterpriseCreateForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        await createEnterprise();
      });
    }

    if (els.enterpriseRefreshBtn) {
      els.enterpriseRefreshBtn.addEventListener("click", () => {
        loadEnterprises();
      });
    }

    if (els.enterpriseTable) {
      els.enterpriseTable.addEventListener("click", (event) => {
        const renameBtn = event.target.closest("[data-enterprise-rename]");
        if (renameBtn) {
          beginEnterpriseRename(renameBtn.dataset.enterpriseRename);
          return;
        }
        const deleteBtn = event.target.closest("[data-enterprise-delete]");
        if (deleteBtn) {
          deleteEnterprise(deleteBtn.dataset.enterpriseDelete);
        }
      });
    }
  }

  // API Call Wrapper with Authorization Bearer header
  async function callApi(url, method = "GET", bodyPayload = null) {
    const token = state.session?.access_token;
    if (!token) {
      throw new Error("로그인 세션 토큰이 없습니다.");
    }

    const headers = {
      "Authorization": `Bearer ${token}`
    };

    if (bodyPayload) {
      headers["Content-Type"] = "application/json";
    }

    const options = {
      method,
      headers
    };

    if (bodyPayload) {
      options.body = JSON.stringify(bodyPayload);
    }

    const res = await fetch(url, options);
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || `API ?몄텧 ?ㅽ뙣 (${res.status})`);
    }

    return json;
  }

  // Fetch Member Details and License History
  async function performLicenseLookup(query) {
    clearFeedback(els.searchFeedback);
    els.userDetailsContainer.style.display = "none";

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
      const params = new URLSearchParams();
      if (isUuid) {
        params.set("userId", query);
      } else {
        params.set("email", query);
      }

      const result = await callApi(`/api/admin-license?${params.toString()}`);

      if (result.ok && result.data) {
        renderUserDetails(result.data);
      } else {
        showFeedback(els.searchFeedback, "?ъ슜?먮? 寃?됲븯吏 紐삵뻽?듬땲??", "error");
      }
    } catch (err) {
      showFeedback(els.searchFeedback, err.message, "error");
    }
  }

  // Bind queried user details to HTML
  function renderUserDetails(data) {
    const profile = data.profile;
    const activeLicense = data.activeLicense;
    const history = data.licenses || [];

    els.userDetailsContainer.style.display = "grid";
    state.currentDeviceTargetEmail = profile.email || "";
    state.selectedFolderEmail = profile.email || "";
    if (state.selectedFolderEmail) {
      setActiveFolderUser(state.selectedFolderEmail);
    }
    resetAdminDevicePanel("등록 PC 조회를 누르면 이 회원의 등록 컴퓨터를 확인할 수 있습니다.");

    // User Profile mapping
    let displayNameText = profile.display_name || "";
    let profileName = "";
    let profileCategory = "";
    let profileNotes = "";

    if (displayNameText) {
      try {
        const parsed = JSON.parse(displayNameText);
        if (parsed && typeof parsed === "object") {
          profileName = parsed.name || "";
          profileCategory = parsed.category || "";
          profileNotes = parsed.notes || "";
        } else {
          profileName = displayNameText;
        }
      } catch (e) {
        profileName = displayNameText;
      }
    }

    const channelLabel = channelPlatformLabel(profile.channel_platform);
    const channelName = profile.channel_name || "";
    const channelUrl = profile.channel_url || "";

    els.profileName.textContent = profileName || "닉네임 없음";
    els.profileEmail.textContent = channelName ? `${channelName} · ${profile.email || "-"}` : profile.email || "-";
    if (els.profileChannel) els.profileChannel.textContent = channelName ? `${channelLabel} · ${channelName}` : `${channelLabel} · 미입력`;
    if (els.profileChannelUrl) {
      els.profileChannelUrl.textContent = channelUrl || "-";
      els.profileChannelUrl.href = channelUrl || "#";
    }
    els.profileId.textContent = profile.user_id;
    els.profileRole.textContent = profile.role || "USER";
    if (els.detailProfileCategory) els.detailProfileCategory.textContent = profileCategory || "미지정";
    if (els.detailProfileNotes) els.detailProfileNotes.textContent = profileNotes || "메모 없음";

    if (els.formProfileName) els.formProfileName.value = profileName;
    if (els.formProfileCategory) els.formProfileCategory.value = profileCategory;
    if (els.formProfileNotes) els.formProfileNotes.value = profileNotes;
    if (els.formChannelPlatform) els.formChannelPlatform.value = profile.channel_platform || "youtube";
    if (els.formChannelName) els.formChannelName.value = channelName;
    if (els.formChannelUrl) els.formChannelUrl.value = channelUrl;

    if (profile.role === "admin" || state.ownerEmails.includes(profile.email?.trim().toLowerCase())) {
      els.profileRole.classList.add("is-admin");
    } else {
      els.profileRole.classList.remove("is-admin");
    }

    // Sync Hidden user-id to form
    els.formUserId.value = profile.user_id;

    // Clear feedback
    clearFeedback(els.licenseFeedback);

    // Check if Active License exists
    if (activeLicense) {
      els.activeLicenseDetails.style.display = "grid";
      els.noActiveLicenseMsg.style.display = "none";

      // Detail panel mapping
      els.licenseId.textContent = activeLicense.id;
      els.licenseCode.textContent = activeLicense.license_code;
      els.licensePlan.textContent = activeLicense.plan;
      els.licensePlan.className = `info-value uppercase badge is-${activeLicense.plan}`;

      els.licenseSigs.textContent = activeLicense.max_signatures.toLocaleString();
      els.licenseMedia.textContent = activeLicense.max_media_mb.toLocaleString();

      const badgeClass = activeLicense.status === "active" ? "active" :
                          activeLicense.status === "pending" ? "pending" :
                          activeLicense.status === "inactive" ? "inactive" :
                          activeLicense.status === "expired" ? "expired" : "suspended";
      els.profileRole.parentElement.querySelector("#detail-license-status").textContent = statusLabels[activeLicense.status] || activeLicense.status;
      els.profileRole.parentElement.querySelector("#detail-license-status").className = `license-status-badge ${badgeClass}`;

      els.licenseExpires.textContent = activeLicense.expires_at ? formatDateTime(activeLicense.expires_at) : "무제한";
      els.licenseNotes.textContent = activeLicense.notes || "메모 없음";

      // Prefill management form
      els.formLicenseId.value = activeLicense.id;
      els.formPlan.value = activeLicense.plan;
      els.formStatus.value = activeLicense.status;
      els.formSigs.value = activeLicense.max_signatures;
      els.formMedia.value = activeLicense.max_media_mb;
      els.formExpires.value = toLocalDatetimeString(activeLicense.expires_at);
      els.flagSharedSync.checked = activeLicense.shared_sync_enabled === true;
      els.formNotes.value = activeLicense.notes || "";

      // Sync standard feature flags checkboxes
      const flags = activeLicense.feature_flags || {};
      document.querySelectorAll(".admin-license-feature").forEach((checkbox) => {
        checkbox.checked = flags[checkbox.value] !== false;
      });

      // Update titles
      els.formTitle.textContent = "라이선스 정보 편집";
      els.formSubmitBtn.textContent = "라이선스 정보 수정";
      els.formSubmitBtn.className = "button primary full-width full-span";

    } else {
      // User has no active license
      els.activeLicenseDetails.style.display = "none";
      els.noActiveLicenseMsg.style.display = "block";

      const statusBadge = els.profileRole.parentElement.querySelector("#detail-license-status");
      statusBadge.textContent = "라이선스 없음";
      statusBadge.className = "license-status-badge inactive";

      // Setup default creation values in form
      els.formLicenseId.value = "";
      els.formPlan.value = "starter";
      els.formStatus.value = "active";
      els.formSigs.value = ""; // Default limits
      els.formMedia.value = "";
      els.formExpires.value = "";
      els.flagSharedSync.checked = false;
      els.formNotes.value = "";

      // Check all checkboxes by default
      document.querySelectorAll(".admin-license-feature").forEach((checkbox) => {
        checkbox.checked = true;
      });

      els.formTitle.textContent = "라이선스 신규 발급";
      els.formSubmitBtn.textContent = "라이선스 신규 발급";
      els.formSubmitBtn.className = "button primary full-width full-span";
    }

    // Render History Table
    renderHistoryTable(history);
  }

  // Populate history log table
  function renderHistoryTable(history) {
    if (!history || history.length === 0) {
      els.licenseHistoryTable.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted">발급 또는 등록된 라이선스 이력이 없습니다.</td>
        </tr>
      `;
      return;
    }

    els.licenseHistoryTable.innerHTML = history.map((license) => {
      const statusText = statusLabels[license.status] || license.status;
      const badgeClass = license.status === "active" ? "active" :
                          license.status === "pending" ? "pending" :
                          license.status === "inactive" ? "inactive" :
                          license.status === "expired" ? "expired" : "suspended";

      const expDate = license.expires_at ? formatDateTime(license.expires_at) : "무제한";
      const notesSnippet = license.notes ? escapeHtml(license.notes).slice(0, 30) + (license.notes.length > 30 ? "..." : "") : "-";

      return `
        <tr>
          <td><code class="info-value is-code">${escapeHtml(license.license_code || "-")}</code></td>
          <td><span class="badge is-${license.plan}">${escapeHtml(license.plan.toUpperCase())}</span></td>
          <td><span class="status-badge ${badgeClass}">${statusText}</span></td>
          <td><strong>${license.max_signatures.toLocaleString()}개</strong></td>
          <td><strong>${license.max_media_mb.toLocaleString()}MB</strong></td>
          <td>${formatDateTime(license.issued_at)}</td>
          <td>${expDate}</td>
          <td title="${escapeHtml(license.notes || '')}">${notesSnippet}</td>
        </tr>
      `;
    }).join("");
  }

  async function lookupAdminDevices() {
    const email = state.currentDeviceTargetEmail || els.searchQuery?.value?.trim();
    if (!email) {
      showFeedback(els.adminDeviceMessage, "먼저 이메일로 회원을 조회해 주세요.", "error");
      return;
    }

    clearFeedback(els.adminDeviceMessage);
    if (els.adminDeviceLookup) els.adminDeviceLookup.disabled = true;
    if (els.adminDeviceClearAll) els.adminDeviceClearAll.disabled = true;
    if (els.adminDeviceResult) {
      els.adminDeviceResult.innerHTML = `<p class="text-muted">등록 PC를 조회하는 중입니다.</p>`;
    }

    try {
      const result = await callApi(`/api/admin-devices?email=${encodeURIComponent(email)}`);
      if (!result.ok) {
        throw new Error(result.error || "등록 PC 조회에 실패했습니다.");
      }
      state.currentDeviceTargetEmail = result.data?.profile?.email || email;
      renderAdminDevices(result.data);
      showFeedback(els.adminDeviceMessage, `등록 PC ${result.data?.devices?.length || 0}개를 조회했습니다.`, "success");
    } catch (err) {
      resetAdminDevicePanel();
      showFeedback(els.adminDeviceMessage, err.message, "error");
    } finally {
      if (els.adminDeviceLookup) els.adminDeviceLookup.disabled = false;
    }
  }

  async function deleteAdminDevice(deviceId) {
    if (!deviceId) {
      showFeedback(els.adminDeviceMessage, "해제할 PC를 선택해 주세요.", "error");
      return;
    }
    if (!window.confirm("선택한 등록 PC를 해제할까요?")) {
      return;
    }

    try {
      await callApi("/api/admin-devices", "DELETE", { deviceId });
      showFeedback(els.adminDeviceMessage, "선택한 PC 등록을 해제했습니다.", "success");
      await lookupAdminDevices();
    } catch (err) {
      showFeedback(els.adminDeviceMessage, err.message, "error");
    }
  }

  async function clearAllAdminDevices() {
    const email = state.currentDeviceTargetEmail;
    if (!email) {
      showFeedback(els.adminDeviceMessage, "먼저 등록 PC를 조회해 주세요.", "error");
      return;
    }
    if (!window.confirm(`${email} 계정의 등록 PC를 모두 해제할까요?`)) {
      return;
    }

    if (els.adminDeviceClearAll) els.adminDeviceClearAll.disabled = true;
    try {
      const result = await callApi("/api/admin-devices", "DELETE", { email, all: true });
      showFeedback(els.adminDeviceMessage, `등록 PC ${result.data?.deletedCount || 0}개를 해제했습니다.`, "success");
      await lookupAdminDevices();
    } catch (err) {
      showFeedback(els.adminDeviceMessage, err.message, "error");
    }
  }

  function resetAdminDevicePanel(message = "회원을 조회한 뒤 등록 PC를 확인할 수 있습니다.") {
    clearFeedback(els.adminDeviceMessage);
    if (els.adminDeviceClearAll) {
      els.adminDeviceClearAll.disabled = true;
    }
    if (els.adminDeviceResult) {
      els.adminDeviceResult.innerHTML = `<p class="text-muted">${escapeHtml(message)}</p>`;
    }
  }

  function renderAdminDevices(data) {
    const devices = data?.devices || [];
    if (els.adminDeviceClearAll) {
      els.adminDeviceClearAll.disabled = devices.length === 0;
    }

    if (!els.adminDeviceResult) {
      return;
    }

    if (devices.length === 0) {
      els.adminDeviceResult.innerHTML = `<p class="text-muted">등록된 PC가 없습니다.</p>`;
      return;
    }

    els.adminDeviceResult.innerHTML = devices.map((device) => {
      const license = device.license;
      const licenseText = license ? `${license.plan || "-"} · ${license.status || "-"} · 최대 ${license.max_devices || 1}대` : "연결된 이용권 없음";
      return `
        <div class="admin-device-row">
          <div class="admin-device-main">
            <strong>${escapeHtml(device.deviceName || "이름 없는 PC")}</strong>
            <small>끝자리 ${escapeHtml(device.fingerprintSuffix || "-")} · ${escapeHtml(device.appVersion || "버전 없음")} · ${escapeHtml(licenseText)}</small>
            <small>등록 ${formatDateTime(device.createdAt)} · 마지막 접속 ${formatDateTime(device.lastSeenAt)}</small>
          </div>
          <button class="button secondary danger-action" type="button" data-admin-device-delete="${escapeHtml(device.id)}">해제</button>
        </div>
      `;
    }).join("");
  }

  // -------------------------------------------------------------------------
  // Web Channel Registration Card (admin-driven streamer page)
  // -------------------------------------------------------------------------

  // 서버 계약과 동일 규칙 (api/_webShared handle · api/shared-profile 공유 코드 · bbbb_enterprises slug)
  const WEB_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
  const WEB_TEAM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/;
  const ENTERPRISE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

  function applyWebPageMode() {
    const lookup = state.webPageLookup;
    clearFeedback(els.webPageFeedback);

    if (els.webPageDeleteBtn) els.webPageDeleteBtn.style.display = "none";

    if (!lookup || !lookup.found) {
      if (els.webPageSubmitBtn) {
        els.webPageSubmitBtn.disabled = true;
        els.webPageSubmitBtn.textContent = "웹 채널 등록";
      }
      if (els.webPageHandle) els.webPageHandle.readOnly = false;
      if (els.webPageStatus) {
        els.webPageStatus.disabled = true;
        els.webPageStatus.value = "active";
      }
      if (lookup && !lookup.found) {
        showFeedback(els.webPageLookupResult, "해당 이메일의 가입 계정이 없습니다. 사용자가 먼저 회원가입해야 합니다.", "error");
      }
      return;
    }

    if (els.webPageSubmitBtn) els.webPageSubmitBtn.disabled = false;

    if (lookup.hasPage && lookup.page) {
      // 수정 모드: handle이 대상 식별자 — 기존 값 프리필, 핸들은 잠금
      showFeedback(els.webPageLookupResult, `기존 웹 채널 @${lookup.page.handle} — 팀코드·공개 여부·상태를 수정합니다.`, "info");
      if (els.webPageHandle) {
        els.webPageHandle.value = lookup.page.handle;
        els.webPageHandle.readOnly = true;
      }
      if (els.webPageNickname) els.webPageNickname.value = "";
      if (els.webPageTeamCode) els.webPageTeamCode.value = lookup.page.team_code || "";
      if (els.webPageEnterprise) els.webPageEnterprise.value = lookup.page.enterprise_slug || "";
      if (els.webPageDirectoryOptin) els.webPageDirectoryOptin.checked = lookup.page.directory_optin !== false;
      if (els.webPageStatus) {
        els.webPageStatus.disabled = false;
        els.webPageStatus.value = lookup.page.status === "hidden" ? "hidden" : "active";
      }
      if (els.webPageSubmitBtn) els.webPageSubmitBtn.textContent = "웹 채널 수정";
      if (els.webPageDeleteBtn) els.webPageDeleteBtn.style.display = "";
      return;
    }

    // 신규 등록 모드
    showFeedback(els.webPageLookupResult, "계정을 확인했습니다. 새 웹 채널을 등록합니다.", "success");
    if (els.webPageHandle) els.webPageHandle.readOnly = false;
    if (els.webPageDirectoryOptin) els.webPageDirectoryOptin.checked = true;
    if (els.webPageStatus) {
      els.webPageStatus.disabled = true;
      els.webPageStatus.value = "active";
    }
    if (els.webPageSubmitBtn) els.webPageSubmitBtn.textContent = "웹 채널 등록";
  }

  async function lookupWebPageAccount() {
    const email = els.webPageEmail ? els.webPageEmail.value.trim().toLowerCase() : "";
    clearFeedback(els.webPageFeedback);
    if (!email) {
      showFeedback(els.webPageLookupResult, "회원 이메일을 입력해 주세요.", "error");
      return;
    }

    if (els.webPageLookupBtn) els.webPageLookupBtn.disabled = true;
    showFeedback(els.webPageLookupResult, "계정을 조회하는 중입니다...", "info");

    try {
      const result = await callApi(`/api/admin-web-page?email=${encodeURIComponent(email)}`);
      if (!result.ok || !result.data) {
        throw new Error(result.error || "계정 조회에 실패했습니다.");
      }
      state.webPageLookup = { email, ...result.data };
      applyWebPageMode();
    } catch (err) {
      state.webPageLookup = null;
      applyWebPageMode();
      showFeedback(els.webPageLookupResult, err.message, "error");
    } finally {
      if (els.webPageLookupBtn) els.webPageLookupBtn.disabled = false;
    }
  }

  async function submitWebPageForm() {
    const lookup = state.webPageLookup;
    clearFeedback(els.webPageFeedback);

    if (!lookup || !lookup.found) {
      showFeedback(els.webPageFeedback, "먼저 회원 이메일을 조회해 주세요.", "error");
      return;
    }

    const handle = els.webPageHandle ? els.webPageHandle.value.trim().toLowerCase() : "";
    if (!WEB_HANDLE_PATTERN.test(handle)) {
      showFeedback(els.webPageFeedback, "핸들은 소문자 영문·숫자·하이픈 3~20자입니다. 하이픈은 처음과 끝에 올 수 없어요.", "error");
      return;
    }

    const teamCode = els.webPageTeamCode ? els.webPageTeamCode.value.trim().toUpperCase() : "";
    if (teamCode && !WEB_TEAM_CODE_PATTERN.test(teamCode)) {
      showFeedback(els.webPageFeedback, "공유 코드는 영문 대문자, 숫자, 하이픈 3~64자로 입력하세요.", "error");
      return;
    }
    if (els.webPageTeamCode) els.webPageTeamCode.value = teamCode;

    // 소속 엔터 slug (선택) — 비우면 무소속, 수정 모드에서 빈 값은 소속 해제
    const enterpriseSlug = els.webPageEnterprise ? els.webPageEnterprise.value.trim().toLowerCase() : "";
    if (enterpriseSlug && !ENTERPRISE_SLUG_PATTERN.test(enterpriseSlug)) {
      showFeedback(els.webPageFeedback, "소속 엔터 slug는 영문 소문자·숫자·하이픈 1~30자입니다.", "error");
      return;
    }
    if (els.webPageEnterprise) els.webPageEnterprise.value = enterpriseSlug;

    const directoryOptin = els.webPageDirectoryOptin ? els.webPageDirectoryOptin.checked : true;
    const isUpdate = lookup.hasPage === true;

    let payload;
    if (isUpdate) {
      payload = {
        handle,
        team_code: teamCode || null,
        enterprise_slug: enterpriseSlug,
        directory_optin: directoryOptin,
        status: els.webPageStatus && els.webPageStatus.value === "hidden" ? "hidden" : "active"
      };
    } else {
      payload = {
        email: lookup.email,
        handle,
        directory_optin: directoryOptin
      };
      const nickname = els.webPageNickname ? els.webPageNickname.value.trim() : "";
      if (nickname) payload.nickname = nickname;
      if (teamCode) payload.team_code = teamCode;
      if (enterpriseSlug) payload.enterprise_slug = enterpriseSlug;
    }

    if (els.webPageSubmitBtn) els.webPageSubmitBtn.disabled = true;
    showFeedback(els.webPageFeedback, isUpdate ? "웹 채널을 수정하는 중입니다..." : "웹 채널을 등록하는 중입니다...", "info");

    try {
      const result = await callApi("/api/admin-web-page", isUpdate ? "PATCH" : "POST", payload);
      if (!result.ok || !result.data?.page) {
        throw new Error(result.error || "요청 처리에 실패했습니다.");
      }
      const page = result.data.page;
      const teamCodeLabel = page.team_code ? ` · 팀코드 ${page.team_code}` : "";
      const enterpriseLabel = page.enterprise_slug ? ` · 엔터 ${page.enterprise_slug}` : "";
      // 최신 페이지 상태로 카드 모드를 갱신한 뒤 결과 메시지를 표시 (갱신이 feedback을 지우므로 순서 유지)
      await lookupWebPageAccount();
      showFeedback(
        els.webPageFeedback,
        `${isUpdate ? "수정 완료" : "등록 완료"}: @${page.handle}${teamCodeLabel}${enterpriseLabel} · ${page.status === "hidden" ? "숨김" : "공개"}`,
        "success"
      );
    } catch (err) {
      showFeedback(els.webPageFeedback, err.message, "error");
    } finally {
      if (els.webPageSubmitBtn) els.webPageSubmitBtn.disabled = false;
    }
  }

  async function deleteWebPage() {
    const lookup = state.webPageLookup;
    clearFeedback(els.webPageFeedback);
    if (!lookup || !lookup.hasPage || !lookup.page) {
      showFeedback(els.webPageFeedback, "삭제할 채널을 먼저 조회해 주세요.", "error");
      return;
    }

    const handle = lookup.page.handle;
    if (
      !window.confirm(
        `@${handle} 채널을 완전히 삭제할까요?\n\n페이지·시그니처·후원 메시지·릴레이 연결이 모두 삭제됩니다. (계정과 라이선스는 유지됩니다.)\n되돌릴 수 없습니다.`
      )
    ) {
      return;
    }

    if (els.webPageDeleteBtn) els.webPageDeleteBtn.disabled = true;
    if (els.webPageSubmitBtn) els.webPageSubmitBtn.disabled = true;
    showFeedback(els.webPageFeedback, "채널을 삭제하는 중입니다...", "info");

    try {
      const result = await callApi("/api/admin-web-page", "DELETE", { handle });
      if (!result.ok || !result.data?.deleted) {
        throw new Error(result.error || "삭제에 실패했습니다.");
      }
      // 삭제 후에는 계정에 페이지가 없는 상태 — 재조회로 카드를 신규 등록 모드로 되돌린다
      await lookupWebPageAccount();
      showFeedback(els.webPageFeedback, `삭제 완료: @${handle} 채널이 제거되었습니다.`, "success");
    } catch (err) {
      showFeedback(els.webPageFeedback, err.message, "error");
    } finally {
      if (els.webPageDeleteBtn) els.webPageDeleteBtn.disabled = false;
      if (els.webPageSubmitBtn) els.webPageSubmitBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------------------
  // Enterprise Management Card (소속 엔터테인먼트 — 목록·생성·이름 수정)
  // v1 정책: 엔터 생성과 페이지 배정은 관리자 전용 (사칭 방지)
  // -------------------------------------------------------------------------

  async function loadEnterprises() {
    if (!els.enterpriseTable) return;

    const requestId = ++state.enterpriseLoadRequestId;
    clearFeedback(els.enterpriseListFeedback);
    els.enterpriseTable.innerHTML = `<tr><td colspan="4" class="text-center text-muted">엔터 목록을 불러오는 중입니다...</td></tr>`;

    try {
      const result = await callApi("/api/admin-enterprises");
      if (requestId !== state.enterpriseLoadRequestId) return;
      if (!result.ok || !result.data) {
        throw new Error(result.error || "엔터 목록을 불러오지 못했습니다.");
      }
      state.enterprises = Array.isArray(result.data.enterprises) ? result.data.enterprises : [];
      renderEnterpriseRows(state.enterprises);
    } catch (err) {
      if (requestId !== state.enterpriseLoadRequestId) return;
      state.enterprises = [];
      els.enterpriseTable.innerHTML = `<tr><td colspan="4" class="text-center text-muted">엔터 목록을 불러오지 못했습니다.</td></tr>`;
      showFeedback(els.enterpriseListFeedback, err.message, "error");
    }
  }

  function renderEnterpriseRows(enterprises) {
    if (!els.enterpriseTable) return;

    if (!enterprises || enterprises.length === 0) {
      els.enterpriseTable.innerHTML = `<tr><td colspan="4" class="text-center text-muted">등록된 엔터가 없습니다. 위에서 새 엔터를 생성하세요.</td></tr>`;
      return;
    }

    els.enterpriseTable.innerHTML = enterprises.map((ent) => `
      <tr data-enterprise-slug="${escapeHtml(ent.slug)}">
        <td><code class="info-value is-code">${escapeHtml(ent.slug)}</code></td>
        <td class="enterprise-name-cell">${escapeHtml(ent.name)}</td>
        <td><strong>${Number(ent.pageCount || 0).toLocaleString()}</strong></td>
        <td>
          <div class="enterprise-row-actions">
            <button class="button secondary" type="button" data-enterprise-rename="${escapeHtml(ent.slug)}">이름 수정</button>
            <button class="button danger-action" type="button" data-enterprise-delete="${escapeHtml(ent.slug)}">삭제</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  function findEnterpriseRow(slug) {
    if (!els.enterpriseTable) return null;
    return Array.from(els.enterpriseTable.querySelectorAll("tr[data-enterprise-slug]"))
      .find((row) => row.dataset.enterpriseSlug === slug) || null;
  }

  function beginEnterpriseRename(slug) {
    const target = (state.enterprises || []).find((ent) => ent.slug === slug);
    if (!target) return;

    // 다른 행이 편집 중이었다면 목록을 원상 복구한 뒤 이 행만 편집 모드로 전환
    renderEnterpriseRows(state.enterprises);
    const row = findEnterpriseRow(slug);
    if (!row) return;

    const nameCell = row.querySelector(".enterprise-name-cell");
    const actionsCell = row.querySelector(".enterprise-row-actions");
    if (!nameCell || !actionsCell) return;

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.value = target.name;
    input.className = "enterprise-rename-input";
    input.setAttribute("aria-label", `${target.slug} 엔터 이름 수정`);
    nameCell.replaceChildren(input);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "button primary";
    saveBtn.textContent = "저장";
    saveBtn.addEventListener("click", () => {
      submitEnterpriseRename(slug, input.value, saveBtn);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "button secondary";
    cancelBtn.textContent = "취소";
    cancelBtn.addEventListener("click", () => {
      renderEnterpriseRows(state.enterprises);
    });

    actionsCell.replaceChildren(saveBtn, cancelBtn);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitEnterpriseRename(slug, input.value, saveBtn);
      } else if (event.key === "Escape") {
        renderEnterpriseRows(state.enterprises);
      }
    });
    input.focus();
  }

  async function submitEnterpriseRename(slug, rawName, saveBtn) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > 40) {
      showFeedback(els.enterpriseListFeedback, "엔터 이름은 1~40자로 입력하세요.", "error");
      return;
    }

    clearFeedback(els.enterpriseListFeedback);
    if (saveBtn) saveBtn.disabled = true;

    try {
      const result = await callApi("/api/admin-enterprises", "PATCH", { slug, name });
      if (!result.ok) {
        throw new Error(result.error || "엔터 이름 수정에 실패했습니다.");
      }
      // 목록 갱신이 feedback을 지우므로 갱신 후 결과 메시지 표시 (웹 채널 카드와 동일 순서)
      await loadEnterprises();
      showFeedback(els.enterpriseListFeedback, `엔터 이름을 수정했습니다: ${slug} → ${name}`, "success");
    } catch (err) {
      if (saveBtn) saveBtn.disabled = false;
      showFeedback(els.enterpriseListFeedback, err.message, "error");
    }
  }

  async function deleteEnterprise(slug) {
    const target = (state.enterprises || []).find((ent) => ent.slug === slug);
    if (!target) return;

    const pageNote =
      Number(target.pageCount || 0) > 0
        ? `\n\n소속된 채널 ${Number(target.pageCount).toLocaleString()}개는 삭제되지 않고 무소속으로 바뀝니다.`
        : "";
    if (!window.confirm(`엔터 "${target.name}" (${slug})를 삭제할까요?${pageNote}\n\n되돌릴 수 없습니다.`)) {
      return;
    }

    clearFeedback(els.enterpriseListFeedback);
    const row = findEnterpriseRow(slug);
    const deleteBtn = row ? row.querySelector("[data-enterprise-delete]") : null;
    if (deleteBtn) deleteBtn.disabled = true;

    try {
      const result = await callApi("/api/admin-enterprises", "DELETE", { slug });
      if (!result.ok || !result.data?.deleted) {
        throw new Error(result.error || "엔터 삭제에 실패했습니다.");
      }
      await loadEnterprises();
      showFeedback(els.enterpriseListFeedback, `엔터를 삭제했습니다: ${slug}`, "success");
    } catch (err) {
      if (deleteBtn) deleteBtn.disabled = false;
      showFeedback(els.enterpriseListFeedback, err.message, "error");
    }
  }

  async function createEnterprise() {
    clearFeedback(els.enterpriseFeedback);

    const name = els.enterpriseName ? els.enterpriseName.value.trim() : "";
    const slug = els.enterpriseSlug ? els.enterpriseSlug.value.trim().toLowerCase() : "";

    if (!name || name.length > 40) {
      showFeedback(els.enterpriseFeedback, "엔터 이름은 1~40자로 입력하세요.", "error");
      return;
    }
    if (!ENTERPRISE_SLUG_PATTERN.test(slug)) {
      showFeedback(els.enterpriseFeedback, "slug는 영문 소문자·숫자·하이픈 1~30자이며 하이픈으로 시작할 수 없습니다.", "error");
      return;
    }
    if (els.enterpriseSlug) els.enterpriseSlug.value = slug;

    if (els.enterpriseCreateBtn) els.enterpriseCreateBtn.disabled = true;
    showFeedback(els.enterpriseFeedback, "엔터를 생성하는 중입니다...", "info");

    try {
      const result = await callApi("/api/admin-enterprises", "POST", { name, slug });
      if (!result.ok) {
        throw new Error(result.error || "엔터 생성에 실패했습니다.");
      }
      if (els.enterpriseName) els.enterpriseName.value = "";
      if (els.enterpriseSlug) els.enterpriseSlug.value = "";
      await loadEnterprises();
      showFeedback(els.enterpriseFeedback, `엔터를 생성했습니다: ${name} (${slug})`, "success");
    } catch (err) {
      showFeedback(els.enterpriseFeedback, err.message, "error");
    } finally {
      if (els.enterpriseCreateBtn) els.enterpriseCreateBtn.disabled = false;
    }
  }

  // Submit handler: Create (POST) or Edit (PATCH) license
  async function handleLicenseFormSubmit() {
    clearFeedback(els.licenseFeedback);
    els.formSubmitBtn.disabled = true;

    const userId = els.formUserId.value;
    const licenseId = els.formLicenseId.value;
    const plan = els.formPlan.value;
    const status = els.formStatus.value;
    const notes = els.formNotes.value.trim();

    // Read limits integers
    const maxSignatures = els.formSigs.value.trim() ? parseInt(els.formSigs.value, 10) : undefined;
    const maxMediaMb = els.formMedia.value.trim() ? parseInt(els.formMedia.value, 10) : undefined;

    // Expiry Date formatting
    let expiresAt = null;
    if (els.formExpires.value) {
      expiresAt = new Date(els.formExpires.value).toISOString();
    }

    // Gather feature flags from checkboxes
    const featureFlags = {};
    document.querySelectorAll(".admin-license-feature").forEach((checkbox) => {
      featureFlags[checkbox.value] = checkbox.checked;
    });

    // Add shared sync to flags if needed
    const sharedSyncEnabled = els.flagSharedSync.checked;

    const isUpdate = !!licenseId;
    const apiEndpoint = "/api/admin-license";
    const apiMethod = isUpdate ? "PATCH" : "POST";

    const payload = {
      plan,
      status,
      expiresAt,
      notes,
      featureFlags,
      sharedSyncEnabled,
      profileName: els.formProfileName ? els.formProfileName.value.trim() : "",
      profileCategory: els.formProfileCategory ? els.formProfileCategory.value.trim() : "",
      profileNotes: els.formProfileNotes ? els.formProfileNotes.value.trim() : "",
      channelPlatform: els.formChannelPlatform ? els.formChannelPlatform.value : "youtube",
      channelName: els.formChannelName ? els.formChannelName.value.trim() : "",
      channelUrl: els.formChannelUrl ? els.formChannelUrl.value.trim() : ""
    };

    if (isUpdate) {
      payload.licenseId = licenseId;
    } else {
      payload.userId = userId;
    }

    // Handle limits manual overrides
    if (maxSignatures !== undefined) payload.maxSignatures = maxSignatures;
    if (maxMediaMb !== undefined) payload.maxMediaMb = maxMediaMb;

    try {
      const result = await callApi(apiEndpoint, apiMethod, payload);
      if (result.ok) {
        showFeedback(els.licenseFeedback, isUpdate ? "라이선스 정보가 성공적으로 수정되었습니다." : "새 라이선스가 성공적으로 발급되었습니다.", "success");

        // Refresh User detail panel and folders tree
        if (state.currentSearchQuery) {
          setTimeout(() => {
            performLicenseLookup(state.currentSearchQuery);
            loadFolderStructure();
          }, 800);
        } else {
          setTimeout(() => {
            loadFolderStructure();
          }, 800);
        }
      } else {
        showFeedback(els.licenseFeedback, result.error || "?붿껌 泥섎━???ㅽ뙣?덉뒿?덈떎.", "error");
      }
    } catch (err) {
      showFeedback(els.licenseFeedback, err.message, "error");
    } finally {
      els.formSubmitBtn.disabled = false;
    }
  }

  // Handle Tab 2 Code Generator form submission
  async function handleCodeGeneratorSubmit() {
    clearFeedback(els.codeFeedback);
    els.codeResultPanel.style.display = "none";

    const plan = els.codePlan.value;
    const mode = els.codeMode.value;
    const durationUnit = els.codeDurationUnit.value;
    const durationValue = durationUnit === "unlimited" ? undefined : parseInt(els.codeDurationValue.value, 10);
    const maxRedemptions = parseInt(els.codeMaxRedemptions.value, 10) || 1;
    const notes = els.codeNotes.value.trim();

    let validUntil = null;
    if (els.codeValidUntil.value) {
      validUntil = new Date(els.codeValidUntil.value).toISOString();
    }

    // Gather feature flags
    const featureFlags = {};
    document.querySelectorAll(".admin-code-feature").forEach((checkbox) => {
      featureFlags[checkbox.value] = checkbox.checked;
    });

    // Read shared sync flag checkbox
    const sharedSyncEnabled = els.codeFlagSharedSync.checked;

    const payload = {
      plan,
      mode,
      durationUnit,
      durationValue,
      maxRedemptions,
      validUntil,
      notes,
      featureFlags,
      sharedSyncEnabled
    };

    try {
      const result = await callApi("/api/admin-license-code", "POST", payload);

      if (result.ok && result.data) {
        showFeedback(els.codeFeedback, "이용권 코드가 정상적으로 발급되었습니다.", "success");

        // Show result display
        els.codeResultPanel.style.display = "block";
        els.resultCodeDisplay.value = result.data.code;

        // Display limits & badge info
        els.resultCodeBadge.textContent = result.data.codeInfo.plan.toUpperCase();
        els.resultCodeBadge.className = `badge is-${result.data.codeInfo.plan}`;

        let durLabel = "영구 이용권";
        if (result.data.codeInfo.duration_hours) {
          const hrs = result.data.codeInfo.duration_hours;
          durLabel = hrs % 24 === 0 ? `${hrs / 24}일 이용권` : `${hrs}시간 이용권`;
        }
        els.resultCodeDuration.textContent = durLabel;
        els.resultCodeRedemptions.textContent = `(최대 ${result.data.codeInfo.max_redemptions}회 등록)`;

        // Reset notes and logs
        els.codeNotes.value = "";

        // Refresh codes list
        await loadRecentCodes();
      } else {
        showFeedback(els.codeFeedback, result.error || "코드 발급 실패", "error");
      }
    } catch (err) {
      showFeedback(els.codeFeedback, err.message, "error");
    }
  }

  // Load Recent Codes and redemption logs
  async function loadRecentCodes() {
    try {
      const result = await callApi("/api/admin-license-code", "GET");
      if (result.ok && result.data) {
        renderRecentCodesTable(result.data.codes || []);
        renderRecentRedemptionsTable(result.data.redemptions || []);
      }
    } catch (err) {
      console.error(err);
      els.recentCodesTable.innerHTML = `<tr><td colspan="6" class="text-center text-muted">이용권 이력을 읽어오지 못했습니다. ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderRecentCodesTable(codes) {
    if (!codes || codes.length === 0) {
      els.recentCodesTable.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted">최근 생성된 이용권 코드가 없습니다.</td>
        </tr>
      `;
      return;
    }

    els.recentCodesTable.innerHTML = codes.map((c) => {
      const durLabel = c.duration_hours ? `${c.duration_hours}시간` : "영구";
      const redemptionText = `${c.redeemed_count} / ${c.max_redemptions}`;
      const expiresText = c.valid_until ? formatDateTime(c.valid_until) : "무제한";
      const cleanNotes = escapeHtml(c.notes || "-");

      return `
        <tr>
          <td><code class="info-value is-code">${escapeHtml(c.code_prefix || "CODE")}-****</code></td>
          <td><span class="badge is-${c.plan}">${escapeHtml(c.plan.toUpperCase())}</span></td>
          <td><strong>${durLabel}</strong></td>
          <td><strong>${redemptionText}</strong></td>
          <td>${expiresText}</td>
          <td title="${cleanNotes}">${cleanNotes.slice(0, 24) + (cleanNotes.length > 24 ? "..." : "")}</td>
        </tr>
      `;
    }).join("");
  }

  function renderRecentRedemptionsTable(redemptions) {
    if (!redemptions || redemptions.length === 0) {
      els.recentRedemptionsTable.innerHTML = `
        <tr>
          <td colspan="3" class="text-center text-muted">최근 등록 이력이 없습니다.</td>
        </tr>
      `;
      return;
    }

    els.recentRedemptionsTable.innerHTML = redemptions.map((r) => {
      return `
        <tr>
          <td><code>${escapeHtml(r.code_id || "-")}</code></td>
          <td><code style="background: none; border: none; padding: 0;">${escapeHtml(r.user_id || "-")}</code></td>
          <td>${formatDateTime(r.redeemed_at)}</td>
        </tr>
      `;
    }).join("");
  }

  // General Utilities
  function showFeedback(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = `feedback-msg ${type}`;
    element.style.display = "block";
  }

  function clearFeedback(element) {
    if (!element) return;
    element.textContent = "";
    element.className = "feedback-msg";
    element.style.display = "none";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(isoString) {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());

    return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
  }

  function toLocalDatetimeString(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";

    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());

    return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
  }

  function parseProfileMeta(displayName) {
    const meta = { name: "", category: "분류 없음", notes: "" };
    if (!displayName) {
      return meta;
    }

    try {
      const parsed = JSON.parse(displayName);
      if (parsed && typeof parsed === "object") {
        meta.name = typeof parsed.name === "string" ? parsed.name : "";
        meta.category = typeof parsed.category === "string" && parsed.category.trim() ? parsed.category.trim() : "분류 없음";
        meta.notes = typeof parsed.notes === "string" ? parsed.notes : "";
        return meta;
      }
    } catch (error) {
      meta.name = displayName;
      return meta;
    }

    meta.name = displayName;
    return meta;
  }

  function normalizeFolderProfile(profile) {
    const meta = parseProfileMeta(profile.display_name || "");
    return {
      user_id: profile.user_id,
      email: profile.email || "이메일 없음",
      name: meta.name,
      category: meta.category,
      notes: meta.notes,
      channelName: profile.channel_name || "",
      channelPlatform: profile.channel_platform || "youtube"
    };
  }

  function setFolderBulkMessage(message, type = "info") {
    if (!els.folderBulkMessage) return;
    if (!message) {
      clearFeedback(els.folderBulkMessage);
      return;
    }
    showFeedback(els.folderBulkMessage, message, type);
  }

  function getSelectedFolderUserIds() {
    return Array.from(state.selectedFolderUserIds).filter(Boolean);
  }

  function updateFolderSelectionUi() {
    const selectedIds = getSelectedFolderUserIds();
    if (els.folderSelectedCount) {
      els.folderSelectedCount.textContent = `선택 ${selectedIds.length}명`;
    }
    if (els.folderMoveBtn) {
      els.folderMoveBtn.disabled = selectedIds.length === 0;
    }
    if (els.folderBulkLicenseBtn) {
      els.folderBulkLicenseBtn.disabled = selectedIds.length === 0;
    }

    if (els.foldersContainer) {
      els.foldersContainer.querySelectorAll(".folder-user-checkbox").forEach((checkbox) => {
        checkbox.checked = state.selectedFolderUserIds.has(checkbox.value);
      });
      els.foldersContainer.querySelectorAll(".folder-group").forEach((group) => {
        syncFolderCategoryCheckbox(group);
      });
    }
  }

  function clearFolderSelection() {
    state.selectedFolderUserIds.clear();
    updateFolderSelectionUi();
    setFolderBulkMessage("");
  }

  function selectAllVisibleFolderUsers() {
    state.folderProfiles.forEach((profile) => {
      if (profile.user_id) {
        state.selectedFolderUserIds.add(profile.user_id);
      }
    });
    updateFolderSelectionUi();
  }

  function toggleFolderCategorySelection(users, checked) {
    users.forEach((user) => {
      if (!user.user_id) return;
      if (checked) {
        state.selectedFolderUserIds.add(user.user_id);
      } else {
        state.selectedFolderUserIds.delete(user.user_id);
      }
    });
    updateFolderSelectionUi();
  }

  function syncFolderCategoryCheckbox(folderGroup) {
    const checkbox = folderGroup.querySelector(".folder-category-checkbox");
    if (!checkbox) return;
    const userCheckboxes = Array.from(folderGroup.querySelectorAll(".folder-user-checkbox"));
    const checkedCount = userCheckboxes.filter((input) => state.selectedFolderUserIds.has(input.value)).length;
    checkbox.checked = userCheckboxes.length > 0 && checkedCount === userCheckboxes.length;
    checkbox.indeterminate = checkedCount > 0 && checkedCount < userCheckboxes.length;
  }

  async function moveSelectedFolderUsers() {
    const userIds = getSelectedFolderUserIds();
    if (!userIds.length) return;

    const category = els.folderMoveTarget?.value.trim() || "분류 없음";
    if (!confirm(`${userIds.length}명을 "${category}" 폴더로 이동할까요?`)) {
      return;
    }

    if (els.folderMoveBtn) els.folderMoveBtn.disabled = true;
    setFolderBulkMessage("선택 회원을 이동하는 중입니다...");

    try {
      const result = await callApi("/api/admin-license-bulk", "POST", {
        action: "move-folder",
        userIds,
        category
      });
      if (!result.ok) {
        throw new Error(result.error || "folder-move-failed");
      }
      clearFolderSelection();
      setFolderBulkMessage(`${result.data?.updatedProfiles || 0}명을 이동했습니다.`, "success");
      await loadFolderStructure();
    } catch (error) {
      setFolderBulkMessage(error.message, "error");
      updateFolderSelectionUi();
    }
  }

  async function updateSelectedFolderLicenses() {
    const userIds = getSelectedFolderUserIds();
    if (!userIds.length) return;

    const license = {};
    if (els.folderBulkPlan?.value) license.plan = els.folderBulkPlan.value;
    if (els.folderBulkStatus?.value) license.status = els.folderBulkStatus.value;
    if (els.folderBulkSigs?.value.trim()) license.maxSignatures = Number(els.folderBulkSigs.value);
    if (els.folderBulkMedia?.value.trim()) license.maxMediaMb = Number(els.folderBulkMedia.value);
    if (els.folderBulkExpires?.value) license.expiresAt = els.folderBulkExpires.value;
    if (els.folderBulkSharedSync?.value) license.sharedSyncEnabled = els.folderBulkSharedSync.value === "true";

    if (Object.keys(license).length === 0) {
      setFolderBulkMessage("변경할 라이선스 값을 하나 이상 입력하세요.", "error");
      return;
    }

    if (!confirm(`선택한 ${userIds.length}명의 기존 라이선스를 일괄 수정할까요?`)) {
      return;
    }

    if (els.folderBulkLicenseBtn) els.folderBulkLicenseBtn.disabled = true;
    setFolderBulkMessage("선택 회원 라이선스를 수정하는 중입니다...");

    try {
      const result = await callApi("/api/admin-license-bulk", "POST", {
        action: "update-licenses",
        userIds,
        license
      });
      if (!result.ok) {
        throw new Error(result.error || "bulk-license-update-failed");
      }
      const updated = result.data?.updatedLicenses || 0;
      const skipped = result.data?.skippedNoLicense || 0;
      setFolderBulkMessage(`라이선스 ${updated}건 수정 완료${skipped ? `, 라이선스 없는 회원 ${skipped}명 건너뜀` : ""}.`, "success");
      if (state.currentSearchQuery) {
        await performLicenseLookup(state.currentSearchQuery);
      }
      await loadFolderStructure();
    } catch (error) {
      setFolderBulkMessage(error.message, "error");
    } finally {
      updateFolderSelectionUi();
    }
  }

  // Load Folder Structure and list profiles classified into folders
  async function loadFolderStructure() {
    if (!els.foldersContainer || !els.foldersLoadingMsg) return;

    const requestId = ++state.folderLoadRequestId;
    const previousCollapsed = getCollapsedFolderCategories();
    state.collapsedFolderCategories = previousCollapsed;

    els.foldersLoadingMsg.style.display = "block";
    els.foldersLoadingMsg.textContent = "회원 목록을 불러오는 중입니다...";

    try {
      const result = await callApi("/api/admin-license");
      if (requestId !== state.folderLoadRequestId) return;

      const fragment = document.createDocumentFragment();

      if (result.ok && result.data?.profiles) {
        const profiles = result.data.profiles.map(normalizeFolderProfile);
        state.folderProfiles = profiles;
        const currentUserIds = new Set(profiles.map((profile) => profile.user_id));
        state.selectedFolderUserIds.forEach((userId) => {
          if (!currentUserIds.has(userId)) {
            state.selectedFolderUserIds.delete(userId);
          }
        });

        const groups = {};
        profiles.forEach(profile => {
          if (!groups[profile.category]) {
            groups[profile.category] = [];
          }
          groups[profile.category].push(profile);
        });

        const categories = Object.keys(groups).sort();
        const unclassifiedIndex = categories.indexOf("분류 없음");
        if (unclassifiedIndex > -1) {
          categories.splice(unclassifiedIndex, 1);
          categories.push("분류 없음");
        }

        if (els.folderCategoryOptions) {
          els.folderCategoryOptions.replaceChildren(
            ...categories.map((category) => {
              const option = document.createElement("option");
              option.value = category;
              return option;
            })
          );
        }

        if (categories.length === 0) {
          state.selectedFolderUserIds.clear();
          els.foldersContainer.innerHTML = `<div class="text-muted text-center" style="padding: 10px;">가입한 회원이 없습니다.</div>`;
          updateFolderSelectionUi();
        } else {
          categories.forEach(catName => {
            const users = groups[catName];
            const folderGroup = document.createElement("div");
            folderGroup.className = "folder-group";
            folderGroup.dataset.folderCategory = catName;
            if (state.collapsedFolderCategories.has(catName)) {
              folderGroup.classList.add("collapsed");
            }

            const folderHeader = document.createElement("div");
            folderHeader.className = "folder-header";
            folderHeader.setAttribute("role", "button");
            folderHeader.setAttribute("tabindex", "0");
            folderHeader.setAttribute("aria-expanded", folderGroup.classList.contains("collapsed") ? "false" : "true");
            folderHeader.innerHTML = `
              <label class="folder-category-check" title="이 폴더 회원 전체 선택">
                <input class="folder-category-checkbox" type="checkbox" />
              </label>
              <span class="folder-icon">폴더</span>
              <span class="folder-name">${escapeHtml(catName)}</span>
              <span class="folder-count">${users.length}</span>
              <span class="folder-chevron">▾</span>
            `;

            const usersList = document.createElement("div");
            usersList.className = "folder-users-list";

            users.forEach(u => {
              const userItem = document.createElement("div");
              userItem.className = "folder-user-item";
              userItem.dataset.userEmail = u.email;
              userItem.dataset.userId = u.user_id;
              if (u.email === state.selectedFolderEmail || u.email === state.currentSearchQuery) {
                userItem.classList.add("is-selected");
              }
              const channelPrefix = u.channelName ? `${channelPlatformLabel(u.channelPlatform)} ${u.channelName} · ` : "";
              userItem.innerHTML = `
                <label class="folder-user-check" title="회원 선택">
                  <input class="folder-user-checkbox" type="checkbox" value="${escapeHtml(u.user_id)}" />
                </label>
                <span class="user-email">${escapeHtml(channelPrefix + u.email)}</span>
                <span class="user-nickname${u.name ? "" : " is-empty"}">${u.name ? escapeHtml(u.name) : "-"}</span>
                <span class="user-memo-snippet${u.notes ? "" : " is-empty"}" title="${escapeHtml(u.notes)}">${u.notes ? escapeHtml(u.notes) : "-"}</span>
              `;

              const userCheckbox = userItem.querySelector(".folder-user-checkbox");
              userCheckbox.addEventListener("click", (event) => {
                event.stopPropagation();
              });
              userCheckbox.addEventListener("change", () => {
                if (userCheckbox.checked) {
                  state.selectedFolderUserIds.add(u.user_id);
                } else {
                  state.selectedFolderUserIds.delete(u.user_id);
                }
                updateFolderSelectionUi();
              });

              userItem.addEventListener("click", (event) => {
                if (event.target.closest(".folder-user-check")) return;
                if (!u.email || u.email === "이메일 없음") return;
                els.searchQuery.value = u.email;
                state.currentSearchQuery = u.email;
                state.selectedFolderEmail = u.email;
                setActiveFolderUser(u.email);
                performLicenseLookup(u.email).then(() => {
                  els.userDetailsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              });

              usersList.appendChild(userItem);
            });

            const categoryCheckbox = folderHeader.querySelector(".folder-category-checkbox");
            categoryCheckbox.addEventListener("click", (event) => {
              event.stopPropagation();
            });
            categoryCheckbox.addEventListener("change", () => {
              toggleFolderCategorySelection(users, categoryCheckbox.checked);
            });

            folderHeader.addEventListener("click", () => {
              toggleFolderGroup(folderGroup, catName, folderHeader);
            });
            folderHeader.addEventListener("keydown", (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              toggleFolderGroup(folderGroup, catName, folderHeader);
            });

            folderGroup.appendChild(folderHeader);
            folderGroup.appendChild(usersList);
            fragment.appendChild(folderGroup);
          });
          els.foldersContainer.replaceChildren(fragment);
          updateFolderSelectionUi();
        }

        els.foldersLoadingMsg.style.display = "none";
        els.foldersContainer.style.display = "flex";
      } else {
        state.folderProfiles = [];
        els.foldersContainer.replaceChildren();
        els.foldersLoadingMsg.textContent = "회원 목록을 불러오지 못했습니다.";
      }
    } catch (err) {
      if (requestId !== state.folderLoadRequestId) return;
      console.error(err);
      state.folderProfiles = [];
      els.foldersContainer.replaceChildren();
      els.foldersLoadingMsg.textContent = "회원 목록 로드 오류: " + err.message;
    }
  }

  function getCollapsedFolderCategories() {
    const collapsed = new Set(state.collapsedFolderCategories);
    if (!els.foldersContainer) return collapsed;
    els.foldersContainer.querySelectorAll(".folder-group.collapsed").forEach((group) => {
      const category = group.dataset.folderCategory;
      if (category) collapsed.add(category);
    });
    els.foldersContainer.querySelectorAll(".folder-group:not(.collapsed)").forEach((group) => {
      const category = group.dataset.folderCategory;
      if (category) collapsed.delete(category);
    });
    return collapsed;
  }

  function toggleFolderGroup(folderGroup, category, header) {
    const collapsed = folderGroup.classList.toggle("collapsed");
    if (collapsed) {
      state.collapsedFolderCategories.add(category);
    } else {
      state.collapsedFolderCategories.delete(category);
    }
    header?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setActiveFolderUser(email) {
    if (!els.foldersContainer) return;
    els.foldersContainer.querySelectorAll(".folder-user-item.is-selected").forEach((item) => {
      item.classList.remove("is-selected");
    });
    els.foldersContainer.querySelectorAll(".folder-user-item").forEach((item) => {
      if (item.dataset.userEmail === email) {
        item.classList.add("is-selected");
      }
    });
  }

  // Load and start initialization
  window.addEventListener("DOMContentLoaded", init);

})();
