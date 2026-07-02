// ========================================
// Modal 模態窗口組件
// ========================================

// ----------------------------------------
// 基礎 Modal 開關
// Basic Modal open/close functions
// ----------------------------------------

/**
 * 打開指定 Modal
 * Open a modal by ID
 * @param {string} modalId - Modal 的 id 屬性值
 */
window.openModal = (modalId) => {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 防止背景頁面滾動
  }
};

/**
 * Validate a survey step before allowing the next action.
 * @param {number} count - Selected tag count
 * @param {number} minimum - Required selected tag count
 * @returns {boolean} Whether the step can continue
 */
function _validateSurveySelection(count, minimum) {
  if (count >= minimum) return true;

  // Empty selections use the exact product prompt requested by review.
  const message = count === 0 ? SURVEY_MIN_ONE_MESSAGE : SURVEY_MIN_TWO_MESSAGE;
  window.showToast && window.showToast(message, 'warning');
  return false;
}

/**
 * Ask before closing an unfinished personalization survey.
 */
function _requestPersonalizationClose() {
  if (_personalizationCompleted) {
    window.closeModal('personalizationModal', { force: true });
    return;
  }

  // Close button opens an in-page confirmation modal instead of using browser confirm().
  if (_openSurveyCloseConfirmModal()) return;

  // Fallback action: if old pages miss the confirm markup, keep the survey open and notify in-page.
  window.showToast && window.showToast(SURVEY_UNFINISHED_CLOSE_MESSAGE, 'warning');
}

/**
 * Open the unfinished-survey confirmation modal when the shared partial is present.
 * @returns {boolean} Whether the in-page confirmation modal handled the request.
 */
function _openSurveyCloseConfirmModal() {
  const confirmModal = document.getElementById('surveyCloseConfirmModal');
  if (!confirmModal) return false;

  window.openModal('surveyCloseConfirmModal');
  return true;
}

/**
 * Bind the in-page unfinished-survey confirmation actions once.
 */
function _initSurveyCloseConfirmModal() {
  const confirmModal = document.getElementById('surveyCloseConfirmModal');
  if (!confirmModal || confirmModal.dataset.surveyCloseConfirmBound === 'true') return;
  confirmModal.dataset.surveyCloseConfirmBound = 'true';

  confirmModal.querySelector('[data-survey-close-cancel]')?.addEventListener('click', () => {
    // Cancel action only dismisses the confirmation layer and keeps the survey choices intact.
    window.closeModal('surveyCloseConfirmModal', { force: true });
  });

  confirmModal.querySelector('[data-survey-close-confirm]')?.addEventListener('click', () => {
    // Confirm action closes both the confirmation layer and the unfinished personalization survey.
    window.closeModal('surveyCloseConfirmModal', { force: true });
    window.closeModal('personalizationModal', { force: true });
  });
}

/**
 * Persist survey preferences to the profile storage used by member-center.
 * @param {{ styles?: string[], equipment?: string[] }} preferences
 */
function _syncProfilePreferenceStorage(preferences) {
  const profile = JSON.parse(localStorage.getItem('yurui_profile') || '{}');
  // 重點：profile 保留 styles / equipment 結構，攤平值只由讀取端需要時轉換。
  profile.preferences = preferences;
  localStorage.setItem('yurui_profile', JSON.stringify(profile));
  localStorage.setItem('preferences', JSON.stringify(preferences));
}

/**
 * Notify member-center to repaint visible preference tags when it is on the page.
 * @param {{ styles?: string[], equipment?: string[] }} preferences
 */
function _syncVisibleMemberPreferenceTags(preferences) {
  // Direct hook updates the current member-center page without reloading.
  window.syncMemberPreferenceTags && window.syncMemberPreferenceTags(preferences);

  // Event hook lets member-center subscribe when loaded after this module.
  window.dispatchEvent(new CustomEvent('yurui:preferences-updated', {
    detail: preferences,
  }));
}

/**
 * 關閉指定 Modal
 * Close a modal by ID
 * @param {string} modalId - Modal 的 id 屬性值
 */
window.closeModal = (modalId, options = {}) => {
  const modal = document.getElementById(modalId);
  if (modal) {
    // Guard action: unfinished personalization surveys must confirm before closing.
    if (modalId === 'personalizationModal' && !options.force && !_personalizationCompleted) {
      _requestPersonalizationClose();
      return;
    }

    modal.classList.remove('active');
    // 重點：若仍有其他 Modal 開啟，維持 body scroll lock。
    document.body.style.overflow = document.querySelector('.modal.active') ? 'hidden' : '';
  }
};

// ----------------------------------------
// 初始化全局 Modal 監聽器
// Initialize global modal event listeners
// ----------------------------------------

/**
 * 初始化所有 Modal 的通用事件
 * - 點擊背景關閉
 * - 點擊關閉按鈕
 * - ESC 鍵關閉
 */
window.initModalListeners = () => {
  // 點擊 Modal 最外層（背景遮罩）→ 關閉
  if (!document.body.dataset.modalBackdropBound) {
    document.body.dataset.modalBackdropBound = 'true';
    // Backdrop click: personalization survey must stay open until the close button is used.
    document.addEventListener('click', (e) => {
      if (!e.target.classList.contains('modal')) return;
      if (e.target.id === 'personalizationModal') return;
      window.closeModal(e.target.id);
    });
  }

  // 點擊 .modal-close 按鈕 → 關閉所在 Modal
  document.querySelectorAll('.modal-close').forEach(btn => {
    if (btn.dataset.modalCloseBound === 'true') return;
    btn.dataset.modalCloseBound = 'true';
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (!modal) return;
      // Personalization close button requires an unfinished-survey confirmation.
      if (modal.id === 'personalizationModal') {
        _requestPersonalizationClose();
        return;
      }
      window.closeModal(modal.id);
    });
  });

  // ESC 鍵 → 關閉當前開啟的 Modal
  if (!document.body.dataset.modalEscBound) {
    document.body.dataset.modalEscBound = 'true';
    // ESC close is disabled for personalization so users do not lose unfinished choices.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const activeModal = document.querySelector('.modal.active');
      if (!activeModal && document.getElementById('loginModal')?.classList.contains('active')) {
        window.closeModal('loginModal');
        return;
      }
      if (!activeModal || activeModal.id === 'personalizationModal') return;
      window.closeModal(activeModal.id);
    });
  }

  // 初始化登入 Modal 的互動邏輯
  _initLoginModal();
  _initSurveyCloseConfirmModal();
};

// ----------------------------------------
// 步驟 3.2：登入/註冊 Modal
// Step 3.2: Login/Register Modal
// ----------------------------------------

/**
 * 初始化登入/註冊 Modal 的所有互動
 * Initialize login modal interactions:
 * - Google 社群登入（模擬）
 * - LINE 社群登入（模擬）
 */
function _initLoginModal() {
  const loginModal = document.getElementById('loginModal');
  if (!loginModal) return;

  _normalizeLoginModalContent(loginModal);
  loginModal.querySelectorAll('.btn-google-login, .btn-facebook-login, .btn-line-login').forEach(btn => {
    if (btn.dataset.authLoginBound === 'true') return;
    btn.dataset.authLoginBound = 'true';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      _handleLoginSuccess(_getLoginProvider(btn));
    }, true);
  });
}

/**
 * 依按鈕 class 判斷社群登入 provider。
 * @param {HTMLElement} btn - 被點擊的登入按鈕。
 * @returns {string} Provider 顯示名稱。
 */
function _getLoginProvider(btn) {
  if (btn.classList.contains('btn-line-login')) return 'LINE';
  if (btn.classList.contains('btn-facebook-login')) return 'Facebook';
  return 'Google';
}

/**
 * 將 OAuth 按鈕文字統一包進 span，避免文字節點重複。
 * @param {HTMLElement} btn - OAuth button。
 * @param {string} label - 顯示文字。
 */
function _setButtonLabel(btn, label) {
  Array.from(btn.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
  });
  let labelEl = btn.querySelector('.oauth-btn-label');
  if (!labelEl) {
    labelEl = document.createElement('span');
    labelEl.className = 'oauth-btn-label';
    btn.appendChild(labelEl);
  }
  labelEl.textContent = label;
}

/**
 * 建立 Facebook 登入按鈕，讓舊版 partial 也能自動補齊。
 * @returns {HTMLButtonElement} Facebook button。
 */
function _createFacebookLoginButton() {
  const btn = document.createElement('button');
  btn.className = 'btn-facebook-login';
  btn.type = 'button';
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M15.117 8.004h-1.528c-.454 0-.773.319-.773.904v1.178h2.227l-.336 2.186h-1.891V18h-2.269v-5.728H8.656v-2.186h1.891V8.694C10.547 6.82 11.662 6 13.302 6c.79 0 1.473.059 1.815.085v1.919z" fill="#fff"/></svg>';
  return btn;
}

/**
 * 將舊登入/註冊內容簡化為純社群登入內容。
 * @param {HTMLElement} loginModal - 登入 modal root。
 */
function _normalizeLoginModalContent(loginModal) {
  const loginPanel = loginModal.querySelector('[data-panel="login"]') || loginModal.querySelector('.modal-body');
  if (!loginPanel) return;

  loginModal.querySelector('.modal-tabs')?.remove();
  loginModal.querySelector('[data-panel="register"]')?.remove();
  loginModal.querySelector('#loginEmailForm')?.remove();
  loginPanel.querySelector('.divider-or')?.remove();

  let desc = loginPanel.querySelector('.oauth-desc');
  if (!desc) {
    desc = document.createElement('p');
    desc.className = 'oauth-desc';
    loginPanel.insertBefore(desc, loginPanel.firstChild);
  }
  desc.textContent = '使用社群帳號快速登入 / 註冊';

  const googleBtn = loginPanel.querySelector('.btn-google-login');
  let facebookBtn = loginPanel.querySelector('.btn-facebook-login');
  const lineBtn = loginPanel.querySelector('.btn-line-login');
  if (!facebookBtn && googleBtn && lineBtn) {
    facebookBtn = _createFacebookLoginButton();
    loginPanel.insertBefore(facebookBtn, lineBtn);
  }

  if (googleBtn) _setButtonLabel(googleBtn, '使用 Google 帳號登入');
  if (facebookBtn) _setButtonLabel(facebookBtn, '使用 Facebook 帳號登入');
  if (lineBtn) _setButtonLabel(lineBtn, '使用 LINE 帳號登入');

  let privacy = loginPanel.querySelector('.oauth-privacy');
  if (!privacy) {
    privacy = document.createElement('p');
    privacy.className = 'oauth-privacy';
    loginPanel.appendChild(privacy);
  }
  privacy.innerHTML = '登入即代表您同意 Yuruicamp 的 <a href="#">隱私政策</a> 與 <a href="#">服務條款</a>';
}

/**
 * 處理登入成功流程，主站與 booking 共用 YuruiAuth。
 * @param {string} provider - 社群登入 provider。
 */
function _handleLoginSuccess(provider) {
  if (window.YuruiAuth && typeof window.YuruiAuth.loginWithProvider === 'function') {
    window.YuruiAuth.loginWithProvider(provider, {
      close: () => window.closeModal('loginModal'),
    });
    return;
  }

  const user = {
    id: 'user-001',
    name: `${provider} 會員`,
    email: `user@${provider.toLowerCase()}.example`,
    avatar: provider.charAt(0),
    provider: provider.toLowerCase(),
  };
  window.AppState.isLoggedIn = true;
  window.AppState.currentUser = user;
  localStorage.setItem('isLoggedIn', 'true');
  localStorage.setItem('currentUser', JSON.stringify(user));
  localStorage.setItem('yuruiUser', JSON.stringify(user));
  window.saveAppState();
  window.dispatchEvent(new CustomEvent('yurui:auth-changed', { detail: { type: 'login', user } }));
  window.updateNavbarLoginState();
  window.closeModal('loginModal');
  window.showToast && window.showToast(`已使用 ${provider} 登入`, 'success');
  setTimeout(() => window.openPersonalizationModal(), 300);
}

// ----------------------------------------
// 步驟 3.3：個人化問卷 Modal（Stepper）
// Step 3.3: Personalization Questionnaire Modal (Stepper)
// ----------------------------------------

// 儲存用戶選擇的答案
// Store user's selected answers
let _surveyAnswers = {
  styles: [],    // 問題 1：偏好風格
  equipment: [], // 問題 2：想添購的裝備
};

// Survey validation messages shown before users can move between steps or finish.
const SURVEY_MIN_ONE_MESSAGE = '請至少選擇一個選項';
const SURVEY_MIN_TWO_MESSAGE = '請至少選擇兩個選項';
const SURVEY_UNFINISHED_CLOSE_MESSAGE = '選項還未完成要關閉視窗之後再來填寫嗎?';

// Tracks whether the current personalization session reached the Finish action.
let _personalizationCompleted = false;

/**
 * 打開個人化問卷 Modal
 * Open the personalization survey modal
 */
window.openPersonalizationModal = () => {
  // 重置答案
  _surveyAnswers = { styles: [], equipment: [] };
  _personalizationCompleted = false;

  // Clear any stale active choices from a previous unfinished survey session.
  document.querySelectorAll('#personalizationModal .survey-tag.active').forEach(tag => {
    tag.classList.remove('active');
  });

  // 重置到第一步
  _goToSurveyStep(1);

  window.openModal('personalizationModal');
};

/**
 * 初始化個人化問卷的互動邏輯
 * Initialize personalization survey interactions
 */
window.initPersonalizationModal = () => {
  const modal = document.getElementById('personalizationModal');
  if (!modal) return;
  if (modal.dataset.personalizationBound === 'true') return;
  modal.dataset.personalizationBound = 'true';

  // 標籤（Tag）多選邏輯：點擊切換 active 狀態
  // Tag multi-select: toggle active class on click
  modal.addEventListener('click', (e) => {
    // 點擊選項標籤
    if (e.target.classList.contains('survey-tag')) {
      e.target.classList.toggle('active');
    }

    // 點擊「下一步」按鈕（第一步 → 第二步）
    if (e.target.id === 'surveyNextBtn') {
      // 收集第一步的選擇
      const step1Tags = modal.querySelectorAll('[data-step="1"] .survey-tag.active');
      // Next action: require at least 2 step-1 choices before moving forward.
      if (!_validateSurveySelection(step1Tags.length, 2)) return;
      _surveyAnswers.styles = Array.from(step1Tags).map(t => t.dataset.value);
      _goToSurveyStep(2);
    }

    // 點擊「完成」按鈕（第二步 → 完成）
    if (e.target.id === 'surveyFinishBtn') {
      // 收集第二步的選擇
      const step2Tags = modal.querySelectorAll('[data-step="2"] .survey-tag.active');
      const step1Tags = modal.querySelectorAll('[data-step="1"] .survey-tag.active');
      // Finish action: re-check step 1 and require at least 2 step-2 choices.
      if (!_validateSurveySelection(step1Tags.length, 2)) {
        _goToSurveyStep(1);
        return;
      }
      if (!_validateSurveySelection(step2Tags.length, 2)) return;
      _surveyAnswers.styles = Array.from(step1Tags).map(t => t.dataset.value);
      _surveyAnswers.equipment = Array.from(step2Tags).map(t => t.dataset.value);

      // 儲存偏好到全局狀態
      window.AppState.preferences = _surveyAnswers;
      window.saveAppState();
      _syncProfilePreferenceStorage(_surveyAnswers);
      _syncVisibleMemberPreferenceTags(_surveyAnswers);
      _personalizationCompleted = true;

      // 關閉 Modal
      window.closeModal('personalizationModal', { force: true });

      // 顯示成功 Toast
      window.showToast('個人偏好已儲存！我們會為您推薦最適合的商品', 'success', 4000);
    }
  });
};

/**
 * 切換到指定步驟
 * Navigate to a specific survey step
 * @param {number} step - 步驟編號（1 或 2）
 */
function _goToSurveyStep(step) {
  const modal = document.getElementById('personalizationModal');
  if (!modal) return;

  // 切換步驟面板的顯示
  modal.querySelectorAll('.survey-step').forEach(panel => {
    panel.classList.toggle('active', parseInt(panel.dataset.step) === step);
  });

  // 更新進度條的 active 狀態
  modal.querySelectorAll('.stepper-dot').forEach((dot, index) => {
    // 已完成或當前步驟都標為 active
    dot.classList.toggle('active', index + 1 <= step);
  });

  // 更新步驟文字（如 1/2）
  const stepIndicator = modal.querySelector('.stepper-text');
  if (stepIndicator) stepIndicator.textContent = `${step} / 2`;
}

console.log('✓ Modal 組件已初始化');
