'use strict';

(() => {
  const authUi = {
    button: document.getElementById('accountButton'),
    modal: document.getElementById('authModal'),
    close: document.getElementById('authClose'),
    guest: document.getElementById('authGuest'),
    member: document.getElementById('authMember'),
    loginTab: document.getElementById('loginTab'),
    registerTab: document.getElementById('registerTab'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    error: document.getElementById('authError'),
    autoClose: document.getElementById('authAutoClose'),
    countdown: document.getElementById('authCountdown'),
    name: document.getElementById('accountName'),
    binding: document.getElementById('accountBinding'),
    balance: document.getElementById('accountBalance'),
    plan: document.getElementById('accountPlan'),
    bindChannel: document.getElementById('bindChannel'),
    bindDestination: document.getElementById('bindDestination'),
    bindCode: document.getElementById('bindCode'),
    sendBindCode: document.getElementById('sendBindCode'),
    verifyBindCode: document.getElementById('verifyBindCode'),
    bindStatus: document.getElementById('bindStatus'),
    logout: document.getElementById('logoutButton'),
    forgot: document.getElementById('forgotPassword'),
    resetModal: document.getElementById('resetModal'),
    resetClose: document.getElementById('resetClose'),
    resetForm: document.getElementById('resetForm'),
    resetIdentifier: document.getElementById('resetIdentifier'),
    resetChannel: document.getElementById('resetChannel'),
    resetCode: document.getElementById('resetCode'),
    sendResetCode: document.getElementById('sendResetCode'),
    resetPassword: document.getElementById('resetPassword'),
    resetPasswordConfirm: document.getElementById('resetPasswordConfirm'),
    resetProviderStatus: document.getElementById('resetProviderStatus'),
    resetError: document.getElementById('resetError'),
    checkoutModal: document.getElementById('checkoutModal'),
    checkoutClose: document.getElementById('checkoutClose'),
    guestCheckout: document.getElementById('guestCheckout'),
    guestCheckoutHint: document.getElementById('guestCheckoutHint'),
    accountCheckout: document.getElementById('accountCheckout'),
    accountCheckoutHint: document.getElementById('accountCheckoutHint'),
    checkoutPrice: document.getElementById('checkoutPrice'),
    checkoutPriceNote: document.getElementById('checkoutPriceNote'),
    exportPrice: document.getElementById('exportPrice'),
    cloudDraftStatus: document.getElementById('cloudDraftStatus'),
    restoreCloudDraft: document.getElementById('restoreCloudDraft')
  };

  let currentUser = null;
  let cloudDraft = null;
  let cloudSaveTimer = null;
  let pendingDownload = null;
  let authAutoCloseTimer = null;
  let pricing = { guestOwnPdfFen: 100, memberOwnPdfFen: 50, sharedPdfFen: 1 };
  let verificationStatus = { emailConfigured: false, smsConfigured: false, mode: 'production' };

  function notify(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({ error: '服务器返回了无法识别的数据' }));
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  function formatFen(value) {
    return `¥${(Number(value || 0) / 100).toFixed(2)}`;
  }

  function renderPricing(nextPricing) {
    if (nextPricing) pricing = { ...pricing, ...nextPricing };
    authUi.exportPrice.textContent = `游客 ${formatFen(pricing.guestOwnPdfFen)} / 登录 ${formatFen(pricing.memberOwnPdfFen)}`;
    authUi.guestCheckout.querySelector('b').textContent = `游客微信支付 ${formatFen(pricing.guestOwnPdfFen)}`;
    if (!currentUser) authUi.accountCheckout.querySelector('b').textContent = `登录后 ${formatFen(pricing.memberOwnPdfFen)} 下载`;
  }

  function renderAccount(user) {
    const previousUserId = currentUser && currentUser.id;
    currentUser = user || null;
    authUi.guest.hidden = Boolean(currentUser);
    authUi.member.hidden = !currentUser;
    authUi.button.classList.toggle('logged-in', Boolean(currentUser));
    authUi.button.classList.toggle('superuser', Boolean(currentUser && currentUser.isSuperuser));
    authUi.button.querySelector('b').textContent = currentUser ? `${currentUser.isSuperuser ? '超级 · ' : ''}${currentUser.username}` : '登录 / 注册';
    authUi.accountCheckout.querySelector('b').textContent = currentUser ? (currentUser.isSuperuser ? '超级账户免费下载' : `登录用户微信支付 ${formatFen(pricing.memberOwnPdfFen)}`) : `登录后 ${formatFen(pricing.memberOwnPdfFen)} 下载`;
    authUi.accountCheckoutHint.textContent = currentUser
      ? (currentUser.isSuperuser ? '测试权限已启用 · 不扣除余额' : `登录账户专享价格 · 当前余额 ${formatFen(currentUser.balanceFen)}`)
      : `登录账户比游客节省 ${formatFen(pricing.guestOwnPdfFen - pricing.memberOwnPdfFen)}`;
    if (!currentUser) {
      clearTimeout(cloudSaveTimer); cloudSaveTimer = null; cloudDraft = null;
      authUi.cloudDraftStatus.textContent = '未登录 · 暂不同步云端';
      authUi.restoreCloudDraft.hidden = true;
      return;
    }

    authUi.name.textContent = currentUser.username;
    authUi.balance.textContent = currentUser.isSuperuser ? '全部免费' : formatFen(currentUser.balanceFen);
    authUi.plan.textContent = currentUser.isSuperuser ? '超级测试权限 · PDF 与后续收费功能均不扣费' : `登录用户 PDF 每次 ${formatFen(pricing.memberOwnPdfFen)}；游客每次 ${formatFen(pricing.guestOwnPdfFen)}`;
    if (currentUser.isSuperuser) authUi.binding.textContent = '超级权限测试账户';
    else if (currentUser.email) authUi.binding.textContent = currentUser.emailVerified ? `已验证邮箱：${currentUser.email}` : `邮箱待验证：${currentUser.email}`;
    else if (currentUser.phone) authUi.binding.textContent = currentUser.phoneVerified ? `已验证手机：${currentUser.phone}` : `手机待验证：${currentUser.phone}`;
    else authUi.binding.textContent = '尚未绑定邮箱或手机号';
    const preferredChannel = currentUser.email && !currentUser.emailVerified ? 'email' : currentUser.phone && !currentUser.phoneVerified ? 'phone' : 'email';
    authUi.bindChannel.value = preferredChannel;
    authUi.bindDestination.value = preferredChannel === 'email' ? (currentUser.email || '') : (currentUser.phone || '');
    updateBindPlaceholder();
    if (previousUserId !== currentUser.id) refreshCloudDraft();
  }

  function cloudTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function refreshCloudDraft() {
    if (!currentUser) return;
    authUi.cloudDraftStatus.textContent = '正在检查账号云草稿…';
    try {
      const result = await api('/api/draft');
      cloudDraft = result.draft || null;
      if (!cloudDraft) {
        authUi.cloudDraftStatus.textContent = result.expired ? '云草稿已超过 3 天并清理' : '账号云端暂无草稿';
        authUi.restoreCloudDraft.hidden = true;
        return;
      }
      authUi.cloudDraftStatus.textContent = `云端已保存 ${cloudTime(result.updatedAt)} · 3 天有效`;
      authUi.restoreCloudDraft.hidden = false;
    } catch (error) {
      authUi.cloudDraftStatus.textContent = `云同步失败：${error.message}`;
    }
  }

  async function saveCloudDraft(project, showNotice = false) {
    if (!currentUser || !project) return false;
    clearTimeout(cloudSaveTimer); cloudSaveTimer = null;
    authUi.cloudDraftStatus.textContent = '正在同步账号云草稿…';
    try {
      const result = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ project }) });
      cloudDraft = { ...project, savedAt: result.updatedAt, expiresAt: result.expiresAt };
      authUi.cloudDraftStatus.textContent = `云端已保存 ${cloudTime(result.updatedAt)} · 3 天有效`;
      authUi.restoreCloudDraft.hidden = true;
      if (showNotice) notify('账号云草稿已保存，3 天内可恢复');
      return true;
    } catch (error) {
      authUi.cloudDraftStatus.textContent = `云同步失败：${error.message}`;
      if (showNotice) notify(error.message);
      return false;
    }
  }

  function queueCloudDraft(project) {
    if (!currentUser || !project) return;
    clearTimeout(cloudSaveTimer);
    authUi.cloudDraftStatus.textContent = '编辑已记录 · 5 秒后同步云端';
    cloudSaveTimer = setTimeout(() => saveCloudDraft(project, false), 5000);
  }

  async function removeCloudDraft() {
    clearTimeout(cloudSaveTimer); cloudSaveTimer = null;
    if (!currentUser) return false;
    try {
      await api('/api/draft', { method: 'DELETE' });
      cloudDraft = null; authUi.restoreCloudDraft.hidden = true;
      authUi.cloudDraftStatus.textContent = '账号云草稿已删除';
      return true;
    } catch (error) {
      authUi.cloudDraftStatus.textContent = `删除云草稿失败：${error.message}`;
      return false;
    }
  }

  function openModal() {
    clearInterval(authAutoCloseTimer); authAutoCloseTimer = null;
    authUi.autoClose.hidden = true;
    authUi.error.textContent = '';
    authUi.modal.hidden = false;
    document.body.classList.add('modal-open');
    if (!currentUser) document.getElementById('loginIdentifier').focus();
  }

  function closeModal() {
    clearInterval(authAutoCloseTimer); authAutoCloseTimer = null;
    authUi.autoClose.hidden = true;
    authUi.modal.hidden = true;
    document.body.classList.remove('modal-open');
    authUi.error.textContent = '';
  }

  function startAuthAutoClose(seconds = 10) {
    clearInterval(authAutoCloseTimer);
    let remaining = seconds;
    authUi.countdown.textContent = remaining;
    authUi.autoClose.hidden = false;
    authAutoCloseTimer = setInterval(() => {
      remaining--;
      authUi.countdown.textContent = Math.max(remaining, 0);
      if (remaining <= 0) closeModal();
    }, 1000);
  }

  function openCheckout(onAuthorized) {
    pendingDownload = typeof onAuthorized === 'function' ? onAuthorized : null;
    const price = currentUser ? pricing.memberOwnPdfFen : pricing.guestOwnPdfFen;
    authUi.checkoutPrice.textContent = currentUser && currentUser.isSuperuser ? '免费' : formatFen(price);
    authUi.checkoutPriceNote.textContent = currentUser ? (currentUser.isSuperuser ? '超级测试账户不收费' : '登录用户专享价格') : '游客下载价格';
    authUi.checkoutModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function updateBindPlaceholder() {
    const email = authUi.bindChannel.value === 'email';
    authUi.bindDestination.placeholder = email ? '邮箱地址' : '手机号，例如 13800138000';
    authUi.bindDestination.autocomplete = email ? 'email' : 'tel';
  }

  function openResetModal() {
    closeModal();
    authUi.resetError.textContent = '';
    authUi.resetModal.hidden = false;
    document.body.classList.add('modal-open');
    authUi.resetIdentifier.focus();
  }

  function closeResetModal() {
    authUi.resetModal.hidden = true;
    authUi.resetError.textContent = '';
    document.body.classList.remove('modal-open');
  }

  function closeCheckout() {
    authUi.checkoutModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function showTab(name) {
    const login = name === 'login';
    authUi.loginTab.classList.toggle('active', login);
    authUi.registerTab.classList.toggle('active', !login);
    authUi.loginForm.hidden = !login;
    authUi.registerForm.hidden = login;
    authUi.error.textContent = '';
    (login ? document.getElementById('loginIdentifier') : document.getElementById('registerUsername')).focus();
  }

  async function submitForm(form, action, body) {
    const button = form.querySelector('[type="submit"]');
    authUi.error.textContent = ''; button.disabled = true;
    try {
      const result = await api(action, { method: 'POST', body: JSON.stringify(body) });
      renderAccount(result.user); form.reset(); notify(result.message || '操作成功'); startAuthAutoClose(10);
    } catch (error) {
      authUi.error.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  authUi.button.addEventListener('click', openModal);
  authUi.close.addEventListener('click', closeModal);
  authUi.modal.addEventListener('click', event => { if (event.target === authUi.modal) closeModal(); });
  authUi.loginTab.addEventListener('click', () => showTab('login'));
  authUi.registerTab.addEventListener('click', () => showTab('register'));
  authUi.forgot.addEventListener('click', openResetModal);
  authUi.resetClose.addEventListener('click', closeResetModal);
  authUi.resetModal.addEventListener('click', event => { if (event.target === authUi.resetModal) closeResetModal(); });
  authUi.bindChannel.addEventListener('change', updateBindPlaceholder);
  authUi.sendBindCode.addEventListener('click', async () => {
    authUi.bindStatus.textContent = ''; authUi.sendBindCode.disabled = true;
    try {
      const result = await api('/api/auth/contact/request-code', { method: 'POST', body: JSON.stringify({
        channel: authUi.bindChannel.value, destination: authUi.bindDestination.value
      }) });
      authUi.bindStatus.textContent = result.developmentCode
        ? `本地测试验证码：${result.developmentCode}（正式部署不会显示）` : result.message;
    } catch (error) { authUi.bindStatus.textContent = error.message; }
    finally { authUi.sendBindCode.disabled = false; }
  });
  authUi.verifyBindCode.addEventListener('click', async () => {
    authUi.bindStatus.textContent = ''; authUi.verifyBindCode.disabled = true;
    try {
      const result = await api('/api/auth/contact/verify', { method: 'POST', body: JSON.stringify({
        channel: authUi.bindChannel.value, destination: authUi.bindDestination.value, code: authUi.bindCode.value
      }) });
      renderAccount(result.user); authUi.bindCode.value = ''; authUi.bindStatus.textContent = result.message; notify(result.message);
    } catch (error) { authUi.bindStatus.textContent = error.message; }
    finally { authUi.verifyBindCode.disabled = false; }
  });
  authUi.sendResetCode.addEventListener('click', async () => {
    authUi.resetError.textContent = ''; authUi.sendResetCode.disabled = true;
    try {
      const result = await api('/api/auth/password/request-code', { method: 'POST', body: JSON.stringify({
        identifier: authUi.resetIdentifier.value, channel: authUi.resetChannel.value
      }) });
      authUi.resetError.textContent = result.developmentCode
        ? `本地测试验证码：${result.developmentCode}（正式部署不会显示）` : result.message;
    } catch (error) { authUi.resetError.textContent = error.message; }
    finally { authUi.sendResetCode.disabled = false; }
  });
  authUi.resetForm.addEventListener('submit', async event => {
    event.preventDefault(); authUi.resetError.textContent = '';
    if (authUi.resetPassword.value !== authUi.resetPasswordConfirm.value) {
      authUi.resetError.textContent = '两次输入的新密码不一致'; return;
    }
    const button = authUi.resetForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({
        identifier: authUi.resetIdentifier.value, channel: authUi.resetChannel.value,
        code: authUi.resetCode.value, password: authUi.resetPassword.value
      }) });
      authUi.resetForm.reset(); closeResetModal(); openModal(); showTab('login'); notify(result.message);
    } catch (error) { authUi.resetError.textContent = error.message; }
    finally { button.disabled = false; }
  });
  authUi.loginForm.addEventListener('submit', event => {
    event.preventDefault();
    submitForm(authUi.loginForm, '/api/auth/login', {
      identifier: document.getElementById('loginIdentifier').value,
      password: document.getElementById('loginPassword').value
    });
  });
  authUi.registerForm.addEventListener('submit', event => {
    event.preventDefault();
    const password = document.getElementById('registerPassword').value;
    if (password !== document.getElementById('registerPasswordConfirm').value) {
      authUi.error.textContent = '两次输入的密码不一致'; return;
    }
    submitForm(authUi.registerForm, '/api/auth/register', {
      username: document.getElementById('registerUsername').value,
      email: document.getElementById('registerEmail').value,
      password
    });
  });
  authUi.logout.addEventListener('click', async () => {
    authUi.logout.disabled = true; authUi.error.textContent = '';
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      renderAccount(null); closeModal(); notify('已安全退出登录');
    } catch (error) {
      authUi.error.textContent = error.message;
    } finally {
      authUi.logout.disabled = false;
    }
  });
  authUi.checkoutClose.addEventListener('click', closeCheckout);
  authUi.checkoutModal.addEventListener('click', event => { if (event.target === authUi.checkoutModal) closeCheckout(); });
  authUi.accountCheckout.addEventListener('click', () => {
    if (currentUser && currentUser.isSuperuser && pendingDownload) {
      const authorizedDownload = pendingDownload; pendingDownload = null; closeCheckout();
      authorizedDownload(); notify('超级账户测试权限：本次下载免费'); return;
    }
    closeCheckout(); openModal();
    if (currentUser) authUi.error.textContent = '当前余额充值和实际扣费功能尚未接入，因此暂时不能下载。';
  });
  authUi.restoreCloudDraft.addEventListener('click', () => {
    if (!cloudDraft || !window.PindouDraftBridge) return;
    if (window.PindouDraftBridge.restore(cloudDraft)) {
      authUi.restoreCloudDraft.hidden = true;
      authUi.cloudDraftStatus.textContent = '正在恢复账号云草稿…';
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!authUi.checkoutModal.hidden) closeCheckout();
    else if (!authUi.resetModal.hidden) closeResetModal();
    else if (!authUi.modal.hidden) closeModal();
  });

  window.PindouBilling = Object.freeze({ requestOwnDownload: openCheckout, guestOwnPdfFen: 100, memberOwnPdfFen: 50 });
  window.PindouCloudDraft = Object.freeze({
    queueSave: queueCloudDraft,
    save: saveCloudDraft,
    remove: removeCloudDraft,
    refresh: refreshCloudDraft
  });

  api('/api/auth/me')
    .then(result => { renderPricing(result.pricing); renderAccount(result.user); })
    .catch(() => renderAccount(null));
  api('/api/auth/config')
    .then(result => {
      verificationStatus = result.verification || verificationStatus;
      const available = [verificationStatus.emailConfigured && '邮箱', verificationStatus.smsConfigured && '手机'].filter(Boolean);
      authUi.resetProviderStatus.textContent = available.length
        ? `${verificationStatus.mode === 'console' ? '本地测试模式：' : ''}可使用${available.join('或')}验证码。`
        : '验证码发送服务尚未配置，请先完成服务器环境变量配置。';
    })
    .catch(() => { authUi.resetProviderStatus.textContent = '无法读取验证码服务状态'; });
  api('/api/billing/config')
    .then(result => {
      renderPricing(result.pricing);
      const status = result.wechatPay;
      authUi.guestCheckoutHint.textContent = status && status.configured
        ? '商户参数已配置 · 下单接口开发中'
        : '微信支付 Native 商户参数待配置';
    })
    .catch(() => { authUi.guestCheckoutHint.textContent = '无法读取微信支付配置'; });
})();
