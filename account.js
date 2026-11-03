'use strict';

(() => {
  function syncCheckoutPurpose(recharge){
    document.getElementById('checkoutPurpose').textContent=recharge?'本次充值':'本次下载';
    document.getElementById('checkoutEyebrow').textContent=recharge?'账户充值':'下载结算';
  }
  function confirmReplaceOrder(){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='gallery-confirm-dialog payment-confirm-dialog';
      const title=document.createElement('h3');title.textContent='更换付款订单？';
      const copy=document.createElement('p');copy.textContent='更换后，当前订单将立即失效，并重新开始 2 分钟付款倒计时。\n\n如果已经付款，请取消并继续上传原订单的付款截图，不要更换订单或重复付款。';
      const actions=document.createElement('div');const cancel=document.createElement('button'),confirm=document.createElement('button');cancel.textContent='保留当前订单';confirm.textContent='确认更换';
      const finish=value=>{dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>finish(false);confirm.onclick=()=>finish(true);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});actions.append(cancel,confirm);dialog.append(title,copy,actions);document.body.append(dialog);dialog.showModal();cancel.focus();
    });
  }
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
    registerEmail: document.getElementById('registerEmail'),
    registerCode: document.getElementById('registerCode'),
    sendRegisterCode: document.getElementById('sendRegisterCode'),
    registerCodeStatus: document.getElementById('registerCodeStatus'),
    error: document.getElementById('authError'),
    autoClose: document.getElementById('authAutoClose'),
    countdown: document.getElementById('authCountdown'),
    name: document.getElementById('accountName'),
    binding: document.getElementById('accountBinding'),
    balance: document.getElementById('accountBalance'),
    plan: document.getElementById('accountPlan'),
    openRecharge: document.getElementById('openRecharge'),
    bindDestination: document.getElementById('bindDestination'),
    bindCode: document.getElementById('bindCode'),
    sendBindCode: document.getElementById('sendBindCode'),
    verifyBindCode: document.getElementById('verifyBindCode'),
    bindStatus: document.getElementById('bindStatus'),
    securityQuestionSelect: document.getElementById('securityQuestionSelect'),
    securityQuestionAnswer: document.getElementById('securityQuestionAnswer'),
    securityQuestionPassword: document.getElementById('securityQuestionPassword'),
    saveSecurityQuestion: document.getElementById('saveSecurityQuestion'),
    securityQuestionStatus: document.getElementById('securityQuestionStatus'),
    logout: document.getElementById('logoutButton'),
    adminReviewButton: document.getElementById('adminReviewButton'),
    rewardAdminConfig: document.getElementById('rewardAdminConfig'),
    rewardAdminFile: document.getElementById('rewardAdminFile'),
    uploadRewardCode: document.getElementById('uploadRewardCode'),
    rewardAdminStatus: document.getElementById('rewardAdminStatus'),
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
    resetEmailFields: document.getElementById('resetEmailFields'),
    resetSecurityFields: document.getElementById('resetSecurityFields'),
    loadSecurityQuestion: document.getElementById('loadSecurityQuestion'),
    resetSecurityQuestionText: document.getElementById('resetSecurityQuestionText'),
    resetSecurityAnswer: document.getElementById('resetSecurityAnswer'),
    resetProviderStatus: document.getElementById('resetProviderStatus'),
    resetError: document.getElementById('resetError'),
    checkoutModal: document.getElementById('checkoutModal'),
    checkoutClose: document.getElementById('checkoutClose'),
    checkoutTitle: document.getElementById('checkoutTitle'),
    guestCheckout: document.getElementById('guestCheckout'),
    guestCheckoutHint: document.getElementById('guestCheckoutHint'),
    accountCheckout: document.getElementById('accountCheckout'),
    accountCheckoutHint: document.getElementById('accountCheckoutHint'),
    memberRewardCheckout: document.getElementById('memberRewardCheckout'),
    checkoutRecharge: document.getElementById('checkoutRecharge'),
    checkoutPrice: document.getElementById('checkoutPrice'),
    checkoutPriceNote: document.getElementById('checkoutPriceNote'),
    exportGuestPrice: document.getElementById('exportGuestPrice'),
    exportMemberPrice: document.getElementById('exportMemberPrice'),
    downloadAccessBanner: document.getElementById('downloadAccessBanner'),
    downloadAccessCountdown: document.getElementById('downloadAccessCountdown'),
    checkoutOptions: document.querySelector('.checkout-options'),
    checkoutNotice: document.getElementById('checkoutNotice'),
    rechargeSetup: document.getElementById('rechargeSetup'),
    rechargeAmount: document.getElementById('rechargeAmount'),
    createRechargeOrder: document.getElementById('createRechargeOrder'),
    cancelRecharge: document.getElementById('cancelRecharge'),
    rewardCheckout: document.getElementById('rewardCheckout'),
    rewardBack: document.getElementById('rewardBack'),
    rewardOrderId: document.getElementById('rewardOrderId'),
    rewardOrderType: document.getElementById('rewardOrderType'),
    replacePaymentOrder: document.getElementById('replacePaymentOrder'),
    rewardAmount: document.getElementById('rewardAmount'),
    rewardAmountWarning: document.getElementById('rewardAmountWarning'),
    rewardCodeImage: document.getElementById('rewardCodeImage'),
    rewardReference: document.getElementById('rewardReference'),
    rewardProof: document.getElementById('rewardProof'),
    rewardProofName: document.getElementById('rewardProofName'),
    rewardProofPreview: document.getElementById('rewardProofPreview'),
    confirmRewardPaid: document.getElementById('confirmRewardPaid'),
    submitRewardProof: document.getElementById('submitRewardProof'),
    refreshRewardStatus: document.getElementById('refreshRewardStatus'),
    rewardStatus: document.getElementById('rewardStatus'),
    rewardCountdown: document.getElementById('rewardCountdown'),
    rewardCountdownLabel: document.getElementById('rewardCountdownLabel'),
    adminReviewModal: document.getElementById('adminReviewModal'),
    adminReviewClose: document.getElementById('adminReviewClose'),
    adminProofPanel: document.getElementById('adminProofPanel'),
    adminProofImage: document.getElementById('adminProofImage'),
    adminProofOrder: document.getElementById('adminProofOrder'),
    adminProofMeta: document.getElementById('adminProofMeta'),
    adminReviewNote: document.getElementById('adminReviewNote'),
    rejectGuestOrder: document.getElementById('rejectGuestOrder'),
    approveGuestOrder: document.getElementById('approveGuestOrder'),
    refreshGuestOrders: document.getElementById('refreshGuestOrders'),
    adminOrderList: document.getElementById('adminOrderList'),
    adminReviewError: document.getElementById('adminReviewError'),
    balanceInsufficientModal: document.getElementById('balanceInsufficientModal'),
    balanceInsufficientClose: document.getElementById('balanceInsufficientClose'),
    balanceInsufficientCancel: document.getElementById('balanceInsufficientCancel'),
    balanceRequired: document.getElementById('balanceRequired'),
    balanceAvailable: document.getElementById('balanceAvailable'),
    insufficientRecharge: document.getElementById('insufficientRecharge'),
    insufficientDirectPay: document.getElementById('insufficientDirectPay'),
    cloudDraftStatus: document.getElementById('cloudDraftStatus'),
    restoreCloudDraft: document.getElementById('restoreCloudDraft')
  };
  const feedbackUi = {
    button: document.getElementById('feedbackButton'),
    modal: document.getElementById('feedbackModal'),
    close: document.getElementById('feedbackClose'),
    form: document.getElementById('feedbackForm'),
    message: document.getElementById('feedbackMessage'),
    attachment: document.getElementById('feedbackAttachment'),
    attachmentName: document.getElementById('feedbackAttachmentName'),
    contact: document.getElementById('feedbackContact'),
    website: document.getElementById('feedbackWebsite'),
    status: document.getElementById('feedbackStatus')
  };

  let currentUser = null;
  window.addEventListener('pindou-points-updated',event=>{if(currentUser?.id!==event.detail?.userId)return;currentUser.points=event.detail.points;document.getElementById('accountPoints').textContent=`${Number(currentUser.points||0).toFixed(2)} 积分`;});
  let cloudDraft = null;
  let cloudSaveTimer = null;
  let pendingDownload = null;
  let authAutoCloseTimer = null;
  let pricing = { guestOwnPdfFen: 20, memberOwnPdfFen: 10, sharedPdfFen: 1 };
  let verificationStatus = { emailConfigured: false, smsConfigured: false, mode: 'production' };
  let securityQuestions = [];
  let loadedSecurityQuestionIdentifier = '';
  let rewardCodeStatus = { configured: false, trustMode: false, ocrMode: true, paymentWindowSeconds: 120, proofUploadGraceSeconds: 300, imageEndpoint: null };
  let guestOrder = null;
  let accountOrder = null;
  let paymentOwner = 'guest';
  let checkoutMode = 'download';
  let pendingAccountDownloadOrderId = '';
  let rewardProofDataUrl = '';
  let paymentStatusOverride = '';
  let guestOrderPollTimer = null;
  let guestOrderCountdownTimer = null;
  let downloadAccessTimer = null;
  let downloadAccessExpiresAt = 0;
  let selectedAdminOrder = null;

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
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      Object.assign(error, payload, { status: response.status });
      throw error;
    }
    return payload;
  }

  function formatFen(value) {
    return `¥${(Number(value || 0) / 100).toFixed(2)}`;
  }

  function activateDownloadAccess(expiresAt) {
    clearInterval(downloadAccessTimer);
    downloadAccessTimer = null;
    const expiry = Number(expiresAt || 0);
    downloadAccessExpiresAt = expiry;
    const update = () => {
      const remaining = Math.max(0, expiry - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      if (remaining <= 0) {
        downloadAccessExpiresAt = 0;
        authUi.downloadAccessBanner.hidden = true;
        authUi.downloadAccessCountdown.textContent = '00:00';
        clearInterval(downloadAccessTimer);
        downloadAccessTimer = null;
        return;
      }
      authUi.downloadAccessBanner.hidden = false;
      authUi.downloadAccessCountdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };
    update();
    if (expiry > Date.now()) downloadAccessTimer = setInterval(update, 1000);
  }

  async function refreshDownloadAccess() {
    try {
      const endpoint = currentUser ? '/api/payments/account/access' : '/api/payments/guest/order';
      const result = await api(endpoint);
      const order = result.order;
      activateDownloadAccess(order && order.downloadAuthorized ? order.accessExpiresAt : 0);
    } catch (_) {
      activateDownloadAccess(0);
    }
  }

  function renderPricing(nextPricing) {
    if (nextPricing) pricing = { ...pricing, ...nextPricing };
    authUi.exportGuestPrice.textContent = formatFen(pricing.guestOwnPdfFen);
    authUi.exportMemberPrice.textContent = formatFen(pricing.memberOwnPdfFen);
    authUi.guestCheckout.querySelector('b').textContent = `游客赞赏码支付 ${formatFen(pricing.guestOwnPdfFen)}`;
    if (!currentUser) authUi.accountCheckout.querySelector('b').textContent = `会员价 ${formatFen(pricing.memberOwnPdfFen)} 下载`;
  }

  function renderAccount(user) {
    const previousUserId = currentUser && currentUser.id;
    currentUser = user || null;
    authUi.guest.hidden = Boolean(currentUser);
    authUi.member.hidden = !currentUser;
    authUi.button.classList.toggle('logged-in', Boolean(currentUser));
    authUi.button.classList.toggle('superuser', Boolean(currentUser && currentUser.isSuperuser));
    authUi.adminReviewButton.hidden = !Boolean(currentUser && currentUser.isSuperuser) || rewardCodeStatus.trustMode;
    authUi.rewardAdminConfig.hidden = !Boolean(currentUser && currentUser.isSuperuser);
    authUi.guestCheckout.hidden = Boolean(currentUser);
    authUi.memberRewardCheckout.hidden = !Boolean(currentUser) || Boolean(currentUser && currentUser.isSuperuser);
    authUi.checkoutRecharge.hidden = !Boolean(currentUser) || Boolean(currentUser && currentUser.isSuperuser);
    authUi.openRecharge.hidden = Boolean(currentUser && currentUser.isSuperuser);
    authUi.button.querySelector('b').textContent = currentUser ? `${currentUser.isSuperuser ? '超级 · ' : ''}${currentUser.username}` : '登录 / 注册';
    authUi.accountCheckout.querySelector('b').textContent = currentUser ? (currentUser.isSuperuser ? '超级账户免费下载' : `余额支付 ${formatFen(pricing.memberOwnPdfFen)}`) : `会员价 ${formatFen(pricing.memberOwnPdfFen)} 下载`;
    authUi.memberRewardCheckout.querySelector('b').textContent = `赞赏码直接支付 ${formatFen(pricing.memberOwnPdfFen)}`;
    authUi.accountCheckoutHint.textContent = currentUser
      ? (currentUser.isSuperuser ? '测试权限已启用 · 不扣除余额' : `当前余额 ${formatFen(currentUser.balanceFen)} · 付款后 2 分钟可重复下载`)
      : `登录账户比游客节省 ${formatFen(pricing.guestOwnPdfFen - pricing.memberOwnPdfFen)} · 付款后 2 分钟可重复下载`;
    if (!currentUser) {
      clearTimeout(cloudSaveTimer); cloudSaveTimer = null; cloudDraft = null;
      authUi.cloudDraftStatus.textContent = '未登录 · 暂不同步云端';
      authUi.restoreCloudDraft.hidden = true;
      return;
    }

    authUi.name.textContent = currentUser.username;
    authUi.balance.textContent = currentUser.isSuperuser ? '全部免费' : formatFen(currentUser.balanceFen);
    document.getElementById('accountPoints').textContent=`${Number(currentUser.points||0).toFixed(2)} 积分`;
    authUi.plan.textContent = '';
    if (currentUser.isSuperuser) authUi.binding.textContent = '超级权限测试账户';
    else if (currentUser.email) authUi.binding.textContent = currentUser.emailVerified ? `密保邮箱：${currentUser.email}` : `密保邮箱待验证：${currentUser.email}`;
    else authUi.binding.textContent = '尚未设置密保邮箱';
    authUi.bindDestination.value = currentUser.email || '';
    authUi.bindStatus.textContent = currentUser.emailVerified
      ? '当前密保邮箱已验证。填写其他邮箱并完成验证，可以更换密保邮箱。'
      : '验证后，该邮箱可用于登录，并可在“忘记密码”中接收找回验证码。';
    authUi.securityQuestionStatus.textContent = currentUser.hasSecurityQuestion
      ? '已设置备用验证问题。重新保存会替换原答案；找回入口位于登录页的“忘记密码”。'
      : '设置后，可在登录页点击“忘记密码”，通过回答问题重置密码。';
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
    if (typeof onAuthorized === 'function' && downloadAccessExpiresAt > Date.now()) {
      Promise.resolve(onAuthorized())
        .then(() => notify('PDF 已下载；当前重复下载权限仍然有效'))
        .catch(error => notify(`下载失败：${error.message}`));
      return;
    }
    checkoutMode = 'download';
    syncCheckoutPurpose(false);
    pendingDownload = typeof onAuthorized === 'function' ? onAuthorized : null;
    const price = currentUser ? pricing.memberOwnPdfFen : pricing.guestOwnPdfFen;
    authUi.checkoutPrice.textContent = currentUser && currentUser.isSuperuser ? '免费' : formatFen(price);
    authUi.checkoutPriceNote.textContent = currentUser ? (currentUser.isSuperuser ? '超级测试账户不收费' : '登录用户专享价格') : '游客下载价格';
    authUi.checkoutTitle.textContent = '高清 PDF 图纸下载';
    authUi.checkoutOptions.hidden = false;
    authUi.checkoutNotice.hidden = false;
    authUi.rechargeSetup.hidden = true;
    authUi.rewardCheckout.hidden = true;
    authUi.checkoutModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function updateResetMethod() {
    const useQuestion = authUi.resetChannel.value === 'security_question';
    authUi.resetEmailFields.hidden = useQuestion;
    authUi.resetSecurityFields.hidden = !useQuestion;
    authUi.resetCode.required = !useQuestion;
    authUi.resetSecurityAnswer.required = useQuestion;
    loadedSecurityQuestionIdentifier = '';
    authUi.resetSecurityQuestionText.textContent = '请先输入账号并加载问题';
    authUi.resetSecurityAnswer.value = '';
  }

  function openResetModal() {
    closeModal();
    authUi.resetError.textContent = '';
    authUi.resetModal.hidden = false;
    document.body.classList.add('modal-open');
    updateResetMethod();
    authUi.resetIdentifier.focus();
  }

  function closeResetModal() {
    authUi.resetModal.hidden = true;
    authUi.resetError.textContent = '';
    document.body.classList.remove('modal-open');
  }

  function openFeedbackModal() {
    feedbackUi.status.textContent = '';
    feedbackUi.status.className = 'feedback-status';
    feedbackUi.modal.hidden = false;
    document.body.classList.add('modal-open');
    feedbackUi.message.focus();
  }

  function closeFeedbackModal() {
    feedbackUi.modal.hidden = true;
    feedbackUi.status.textContent = '';
    feedbackUi.status.className = 'feedback-status';
    document.body.classList.remove('modal-open');
  }

  function closeCheckout() {
    clearInterval(guestOrderPollTimer); guestOrderPollTimer = null;
    clearInterval(guestOrderCountdownTimer); guestOrderCountdownTimer = null;
    authUi.checkoutModal.hidden = true;
    authUi.balanceInsufficientModal.hidden = true;
    authUi.rechargeSetup.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function showBalanceInsufficient(error) {
    authUi.balanceAvailable.textContent = formatFen(error.balanceFen ?? (currentUser && currentUser.balanceFen));
    authUi.balanceRequired.textContent = formatFen(error.requiredFen ?? pricing.memberOwnPdfFen);
    authUi.balanceInsufficientModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeBalanceInsufficient() {
    authUi.balanceInsufficientModal.hidden = true;
  }

  function paymentOrderStatusText(order) {
    if (order.kind === 'recharge' && order.status === 'consumed') return '充值已到账';
    if (rewardCodeStatus.ocrMode) {
      const paymentWindowOpen = Date.now() < Number(order.paymentExpiresAt);
      const ocrLabels = {
        pending: paymentWindowOpen ? '请在两分钟付款窗口内完成支付' : '付款窗口已结束；已付款用户仍可上传本订单截图',
        submitted: '截图已提交', paid: '付款已确认，2 分钟内可重复下载',
        rejected: `截图校验未通过${order.reviewNote ? `：${order.reviewNote}` : ''}`,
        consumed: '本订单的限时下载权限已结束', expired: '订单已过期，请返回后重新创建'
      };
      return ocrLabels[order.status] || order.status;
    }
    if (rewardCodeStatus.trustMode) {
      const trustLabels = {
        pending: '等待确认已付款',
        submitted: '可以确认已付款并立即下载',
        paid: '已确认，可以下载',
        rejected: '可以重新确认付款并下载',
        consumed: '本次下载已完成',
        expired: '订单已过期，请重新创建'
      };
      return trustLabels[order.status] || order.status;
    }
    const labels = {
      pending: '等待付款凭证', submitted: '付款凭证已提交，等待人工审核',
      paid: '审核已通过，可以下载', rejected: `凭证被驳回${order.reviewNote ? `：${order.reviewNote}` : ''}`,
      consumed: '本订单下载权限已使用', expired: '订单已过期，请重新创建'
    };
    return labels[order.status] || order.status;
  }

  function renderPaymentOrder(order, owner = paymentOwner) {
    paymentStatusOverride = '';
    paymentOwner = owner;
    if (owner === 'guest') guestOrder = order;
    else accountOrder = order;
    authUi.rewardOrderId.textContent = order.id;
    authUi.rewardOrderType.textContent = owner === 'guest' ? '游客下载订单' : (order.kind === 'recharge' ? '账户充值订单' : '账户直接支付订单');
    authUi.rewardAmount.textContent = formatFen(order.amountFen);
    authUi.rewardAmountWarning.hidden = !(owner === 'account' && order.kind === 'recharge');
    if (!authUi.rewardAmountWarning.hidden) {
      authUi.rewardAmountWarning.textContent = `注意：必须支付与订单完全一致的 ${formatFen(order.amountFen)}。金额不一致可能造成严重程序错误；若已发生错误，请勿重复付款，通过“用户反馈”提交付款截图和证据，管理员将在几天内处理。`;
    }
    authUi.rewardStatus.textContent = paymentOrderStatusText(order);
    const editable = ['pending', 'rejected'].includes(order.status);
    authUi.replacePaymentOrder.hidden = !editable;
    authUi.rewardReference.disabled = !editable;
    authUi.rewardProof.disabled = !editable;
    authUi.submitRewardProof.hidden = !rewardCodeStatus.ocrMode || !editable;
    authUi.confirmRewardPaid.hidden = true;
    authUi.refreshRewardStatus.hidden = rewardCodeStatus.ocrMode || rewardCodeStatus.trustMode || !['submitted', 'paid'].includes(order.status);
    if (rewardCodeStatus.trustMode && order.status === 'submitted') authUi.rewardStatus.textContent = '可直接确认已付款并立即下载';
    if (order.downloadAuthorized) activateDownloadAccess(order.accessExpiresAt);
    startPaymentOrderCountdown();
  }

  function startPaymentOrderCountdown() {
    clearInterval(guestOrderCountdownTimer);
    const update = () => {
      const order = paymentOwner === 'guest' ? guestOrder : accountOrder;
      if (!order || !authUi.rewardCountdown) return;
      const now = Date.now();
      const accessOpen = order.status === 'paid' && Number(order.accessExpiresAt || 0) > now;
      if (accessOpen) {
        const remaining = Math.max(0, Number(order.accessExpiresAt) - now);
        const seconds = Math.ceil(remaining / 1000);
        authUi.rewardCountdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        authUi.rewardCountdownLabel.textContent = '重复下载权限剩余时间';
        if (!paymentStatusOverride) authUi.rewardStatus.textContent = '付款已确认，倒计时内可重复下载 PDF';
        return;
      }
      if (order.status === 'paid') {
        clearInterval(guestOrderCountdownTimer); guestOrderCountdownTimer = null;
        order.status = 'consumed';
        authUi.rewardCountdown.textContent = '00:00';
        authUi.rewardCountdownLabel.textContent = '重复下载权限剩余时间';
        if (!paymentStatusOverride) authUi.rewardStatus.textContent = '本订单的 2 分钟下载权限已结束';
        return;
      }
      const paymentExpiresAt = Number(order.paymentExpiresAt || order.createdAt + 120000);
      const uploadExpiresAt = Number(order.expiresAt);
      const paymentWindowOpen = now < paymentExpiresAt;
      const remaining = Math.max(0, (paymentWindowOpen ? paymentExpiresAt : uploadExpiresAt) - now);
      const seconds = Math.ceil(remaining / 1000);
      const minutesText = String(Math.floor(seconds / 60)).padStart(2, '0');
      const secondsText = String(seconds % 60).padStart(2, '0');
      authUi.rewardCountdown.textContent = `${minutesText}:${secondsText}`;
      authUi.rewardCountdownLabel.textContent = paymentWindowOpen ? '付款剩余时间' : '截图上传剩余时间';
      if (!paymentWindowOpen && remaining > 0 && ['pending', 'rejected'].includes(order.status)) {
        if (!paymentStatusOverride) authUi.rewardStatus.textContent = '付款窗口已结束；只有付款时间在前两分钟内的截图可以通过校验';
      }
      if (remaining > 0 || !['pending', 'rejected'].includes(order.status)) return;
      clearInterval(guestOrderCountdownTimer); guestOrderCountdownTimer = null;
      order.status = 'expired';
      authUi.rewardProof.disabled = true; authUi.submitRewardProof.hidden = true;
      if (!paymentStatusOverride) authUi.rewardStatus.textContent = '截图上传期限已经结束，请返回后重新创建订单';
    };
    update();
    const order = paymentOwner === 'guest' ? guestOrder : accountOrder;
    if (order && ((['pending', 'rejected'].includes(order.status) && Number(order.expiresAt) > Date.now()) || (order.status === 'paid' && Number(order.accessExpiresAt || 0) > Date.now()))) {
      guestOrderCountdownTimer = setInterval(update, 1000);
    }
  }

  function startGuestOrderPolling() {
    clearInterval(guestOrderPollTimer);
    if (rewardCodeStatus.trustMode || rewardCodeStatus.ocrMode) return;
    if (!guestOrder || guestOrder.status !== 'submitted') return;
    guestOrderPollTimer = setInterval(() => refreshGuestOrder(true), 5000);
  }

  async function authorizeGuestDownload() {
    if (!guestOrder || guestOrder.status !== 'paid' || !pendingDownload) return;
    const authorizedDownload = pendingDownload; pendingDownload = null;
    clearInterval(guestOrderPollTimer); guestOrderPollTimer = null;
    authUi.rewardStatus.textContent = '付款已确认，正在生成 PDF…';
    try {
      const result = await api('/api/payments/guest/order/consume', { method: 'POST', body: '{}' });
      activateDownloadAccess(result.accessExpiresAt);
      await Promise.resolve(authorizedDownload());
      closeCheckout(); notify('PDF 已下载；付款后 2 分钟内可再次免费下载');
    } catch (error) {
      authUi.rewardStatus.textContent = `下载失败：${error.message}`;
      pendingDownload = authorizedDownload;
    }
  }

  async function authorizeAccountDownload() {
    if (!accountOrder || accountOrder.kind !== 'own_pdf' || accountOrder.status !== 'paid' || !pendingDownload) return;
    const authorizedDownload = pendingDownload; pendingDownload = null;
    authUi.rewardStatus.textContent = '付款已确认，正在生成 PDF…';
    try {
      const result = await api('/api/payments/account/order/consume', {
        method: 'POST', body: JSON.stringify({ orderId: accountOrder.id })
      });
      activateDownloadAccess(result.accessExpiresAt);
      await Promise.resolve(authorizedDownload());
      renderAccount(result.user); closeCheckout(); notify('PDF 已下载；付款后 2 分钟内可再次免费下载');
    } catch (error) {
      authUi.rewardStatus.textContent = `下载失败：${error.message}`;
      pendingDownload = authorizedDownload;
    }
  }

  async function refreshGuestOrder(automatic = false) {
    try {
      const result = await api('/api/payments/guest/order');
      renderPaymentOrder(result.order, 'guest');
      if (result.order.status === 'paid') await authorizeGuestDownload();
      else startGuestOrderPolling();
    } catch (error) {
      if (!automatic) authUi.rewardStatus.textContent = error.message;
    }
  }

  async function openRewardCheckout(replacePending = false) {
    authUi.guestCheckout.disabled = true;
    try {
      resetPaymentProof();
      const result = await api('/api/payments/guest/order', {
        method: 'POST', body: JSON.stringify({ replacePending })
      });
      rewardCodeStatus = result.rewardCode || rewardCodeStatus;
      authUi.checkoutOptions.hidden = true; authUi.checkoutNotice.hidden = true; authUi.rewardCheckout.hidden = false;
      authUi.rewardCodeImage.src = result.rewardCode.imageEndpoint;
      renderPaymentOrder(result.order, 'guest');
      if (result.order.status === 'paid') await authorizeGuestDownload();
      else startGuestOrderPolling();
    } catch (error) { notify(error.message); }
    finally { authUi.guestCheckout.disabled = !rewardCodeStatus.configured; }
  }


  async function openAccountRewardCheckout(kind, amountFen, replacePending = false) {
    if (!currentUser) { closeCheckout(); openModal(); return; }
    syncCheckoutPurpose(kind==='recharge');
    const trigger = kind === 'recharge' ? authUi.createRechargeOrder : authUi.memberRewardCheckout;
    trigger.disabled = true;
    try {
      resetPaymentProof();
      const result = await api('/api/payments/account/order', {
        method: 'POST', body: JSON.stringify({ kind, amountFen, replacePending })
      });
      rewardCodeStatus = result.rewardCode || rewardCodeStatus;
      authUi.checkoutOptions.hidden = true; authUi.checkoutNotice.hidden = true; authUi.rechargeSetup.hidden = true; authUi.rewardCheckout.hidden = false;
      authUi.rewardCodeImage.src = result.rewardCode.imageEndpoint;
      renderPaymentOrder(result.order, 'account');
      if (result.order.status === 'paid') await authorizeAccountDownload();
    } catch (error) { notify(error.message); }
    finally { trigger.disabled = false; }
  }

  function openRechargeCheckout() {
    if (!currentUser || currentUser.isSuperuser) return;
    checkoutMode = 'recharge'; pendingDownload = null;
    syncCheckoutPurpose(true);
    closeModal();
    authUi.checkoutTitle.textContent = '充值账户余额';
    authUi.checkoutPrice.textContent = formatFen(Math.round(Number(authUi.rechargeAmount.value || 10) * 100));
    authUi.checkoutPriceNote.textContent = '到账后可用于 PDF 下载';
    authUi.checkoutOptions.hidden = true; authUi.checkoutNotice.hidden = true; authUi.rewardCheckout.hidden = true; authUi.rechargeSetup.hidden = false;
    authUi.checkoutModal.hidden = false; document.body.classList.add('modal-open');
  }

  function resetPaymentProof() {
    rewardProofDataUrl = '';
    authUi.rewardProof.value = '';
    authUi.rewardProofName.textContent = '尚未选择截图';
    authUi.rewardProofName.classList.remove('has-file');
    authUi.rewardProofPreview.removeAttribute('src');
    authUi.rewardProofPreview.hidden = true;
    authUi.rewardReference.value = '';
  }

  function closeAdminReview() {
    authUi.adminReviewModal.hidden = true; authUi.adminReviewError.textContent = '';
    authUi.adminProofPanel.hidden = true; selectedAdminOrder = null;
    document.body.classList.remove('modal-open');
  }

  function selectAdminOrder(order) {
    selectedAdminOrder = order;
    authUi.adminProofPanel.hidden = false;
    authUi.adminProofImage.src = order.proofUrl;
    authUi.adminProofOrder.textContent = `${order.id} · ${formatFen(order.amountFen)}`;
    authUi.adminProofMeta.textContent = `${order.paymentReference || '未填写支付单号'} · 提交于 ${new Date(order.submittedAt).toLocaleString('zh-CN')}`;
    authUi.adminReviewNote.value = '';
  }

  async function refreshAdminOrders() {
    authUi.adminReviewError.textContent = '';
    try {
      const result = await api('/api/admin/guest-orders?status=submitted');
      authUi.adminOrderList.replaceChildren();
      if (!result.orders.length) {
        const empty = document.createElement('p'); empty.className = 'auth-note'; empty.textContent = '目前没有等待审核的游客订单。';
        authUi.adminOrderList.appendChild(empty); return;
      }
      for (const order of result.orders) {
        const card = document.createElement('div'); card.className = 'admin-order-card';
        const title = document.createElement('strong'); title.textContent = `${order.id} · ${formatFen(order.amountFen)}`;
        const meta = document.createElement('span'); meta.textContent = `${order.paymentReference || '无支付单号'} · ${new Date(order.submittedAt).toLocaleString('zh-CN')}`;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '查看审核'; button.addEventListener('click', () => selectAdminOrder(order));
        card.append(title, meta, button); authUi.adminOrderList.appendChild(card);
      }
    } catch (error) { authUi.adminReviewError.textContent = error.message; }
  }

  async function reviewSelectedGuestOrder(action) {
    if (!selectedAdminOrder) return;
    authUi.approveGuestOrder.disabled = true; authUi.rejectGuestOrder.disabled = true;
    try {
      const result = await api(`/api/admin/guest-orders/${encodeURIComponent(selectedAdminOrder.id)}/review`, {
        method: 'POST', body: JSON.stringify({ action, note: authUi.adminReviewNote.value })
      });
      notify(result.message); authUi.adminProofPanel.hidden = true; selectedAdminOrder = null; await refreshAdminOrders();
    } catch (error) { authUi.adminReviewError.textContent = error.message; }
    finally { authUi.approveGuestOrder.disabled = false; authUi.rejectGuestOrder.disabled = false; }
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
      renderAccount(result.user); await refreshDownloadAccess(); form.reset(); notify(result.message || '操作成功'); startAuthAutoClose(10);
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
  feedbackUi.button.addEventListener('click', openFeedbackModal);
  feedbackUi.close.addEventListener('click', closeFeedbackModal);
  feedbackUi.modal.addEventListener('click', event => { if (event.target === feedbackUi.modal) closeFeedbackModal(); });
  feedbackUi.attachment.addEventListener('change', () => {
    const file = feedbackUi.attachment.files && feedbackUi.attachment.files[0];
    feedbackUi.attachmentName.textContent = file
      ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(file.size >= 1024 * 1024 ? 2 : 1)} MB`
      : '尚未选择图片';
    feedbackUi.attachmentName.classList.toggle('has-file', Boolean(file));
  });
  feedbackUi.form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = feedbackUi.form.querySelector('[type="submit"]');
    button.disabled = true;
    feedbackUi.status.textContent = '正在发送…';
    feedbackUi.status.className = 'feedback-status';
    try {
      const attachmentFile = feedbackUi.attachment.files && feedbackUi.attachment.files[0];
      if (attachmentFile && (!['image/png', 'image/jpeg', 'image/webp'].includes(attachmentFile.type) || attachmentFile.size > 2 * 1024 * 1024)) {
        throw new Error('证据截图须为不超过 2 MB 的 PNG、JPG 或 WEBP 图片');
      }
      const attachmentDataUrl = attachmentFile ? await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('无法读取证据截图'));
        reader.readAsDataURL(attachmentFile);
      }) : '';
      const result = await api('/api/feedback', { method: 'POST', body: JSON.stringify({
        message: feedbackUi.message.value,
        contact: feedbackUi.contact.value,
        website: feedbackUi.website.value,
        attachmentDataUrl
      }) });
      feedbackUi.form.reset();
      feedbackUi.attachmentName.textContent = '尚未选择图片';
      feedbackUi.attachmentName.classList.remove('has-file');
      feedbackUi.status.textContent = result.message;
      feedbackUi.status.className = 'feedback-status success';
      notify(result.message);
    } catch (error) {
      feedbackUi.status.textContent = error.message;
      feedbackUi.status.className = 'feedback-status error';
    } finally { button.disabled = false; }
  });
  authUi.resetClose.addEventListener('click', closeResetModal);
  authUi.resetModal.addEventListener('click', event => { if (event.target === authUi.resetModal) closeResetModal(); });
  authUi.resetChannel.addEventListener('change', updateResetMethod);
  authUi.sendBindCode.addEventListener('click', async () => {
    authUi.bindStatus.textContent = ''; authUi.sendBindCode.disabled = true;
    try {
      const result = await api('/api/auth/contact/request-code', { method: 'POST', body: JSON.stringify({
        channel: 'email', destination: authUi.bindDestination.value
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
        channel: 'email', destination: authUi.bindDestination.value, code: authUi.bindCode.value
      }) });
      renderAccount(result.user); authUi.bindCode.value = ''; authUi.bindStatus.textContent = result.message; notify(result.message);
    } catch (error) { authUi.bindStatus.textContent = error.message; }
    finally { authUi.verifyBindCode.disabled = false; }
  });
  authUi.saveSecurityQuestion.addEventListener('click', async () => {
    authUi.securityQuestionStatus.textContent = ''; authUi.saveSecurityQuestion.disabled = true;
    try {
      const result = await api('/api/auth/security-question', { method: 'POST', body: JSON.stringify({
        questionId: authUi.securityQuestionSelect.value,
        answer: authUi.securityQuestionAnswer.value,
        currentPassword: authUi.securityQuestionPassword.value
      }) });
      renderAccount(result.user);
      authUi.securityQuestionAnswer.value = '';
      authUi.securityQuestionPassword.value = '';
      authUi.securityQuestionStatus.textContent = result.message;
      notify(result.message);
    } catch (error) { authUi.securityQuestionStatus.textContent = error.message; }
    finally { authUi.saveSecurityQuestion.disabled = false; }
  });
  authUi.sendRegisterCode.addEventListener('click', async () => {
    authUi.error.textContent = ''; authUi.registerCodeStatus.textContent = ''; authUi.sendRegisterCode.disabled = true;
    try {
      const result = await api('/api/auth/register/request-code', { method: 'POST', body: JSON.stringify({
        username: document.getElementById('registerUsername').value,
        email: authUi.registerEmail.value
      }) });
      authUi.registerCodeStatus.textContent = result.developmentCode
        ? `本地测试验证码：${result.developmentCode}（正式部署会发送到邮箱）`
        : result.message;
    } catch (error) { authUi.registerCodeStatus.textContent = error.message; }
    finally { authUi.sendRegisterCode.disabled = !verificationStatus.emailConfigured; }
  });
  authUi.sendResetCode.addEventListener('click', async () => {
    authUi.resetError.textContent = ''; authUi.sendResetCode.disabled = true;
    try {
      const result = await api('/api/auth/password/request-code', { method: 'POST', body: JSON.stringify({
        identifier: authUi.resetIdentifier.value, channel: 'email'
      }) });
      authUi.resetError.textContent = result.developmentCode
        ? `本地测试验证码：${result.developmentCode}（正式部署不会显示）` : result.message;
    } catch (error) { authUi.resetError.textContent = error.message; }
    finally { authUi.sendResetCode.disabled = false; }
  });
  authUi.loadSecurityQuestion.addEventListener('click', async () => {
    authUi.resetError.textContent = ''; authUi.loadSecurityQuestion.disabled = true;
    const identifier = authUi.resetIdentifier.value.normalize('NFKC').trim();
    try {
      const result = await api(`/api/auth/security-question?identifier=${encodeURIComponent(identifier)}`);
      loadedSecurityQuestionIdentifier = identifier;
      authUi.resetSecurityQuestionText.textContent = result.question.text;
      authUi.resetSecurityAnswer.focus();
    } catch (error) {
      loadedSecurityQuestionIdentifier = '';
      authUi.resetSecurityQuestionText.textContent = '无法加载验证问题';
      authUi.resetError.textContent = error.message;
    } finally { authUi.loadSecurityQuestion.disabled = false; }
  });
  authUi.resetForm.addEventListener('submit', async event => {
    event.preventDefault(); authUi.resetError.textContent = '';
    if (authUi.resetPassword.value !== authUi.resetPasswordConfirm.value) {
      authUi.resetError.textContent = '两次输入的新密码不一致'; return;
    }
    const useQuestion = authUi.resetChannel.value === 'security_question';
    const identifier = authUi.resetIdentifier.value.normalize('NFKC').trim();
    if (useQuestion && loadedSecurityQuestionIdentifier !== identifier) {
      authUi.resetError.textContent = '请先加载当前账号的验证问题'; return;
    }
    const button = authUi.resetForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = useQuestion
        ? await api('/api/auth/password/reset-with-security-question', { method: 'POST', body: JSON.stringify({
          identifier, answer: authUi.resetSecurityAnswer.value, password: authUi.resetPassword.value
        }) })
        : await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({
          identifier, channel: 'email', code: authUi.resetCode.value, password: authUi.resetPassword.value
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
      email: authUi.registerEmail.value,
      code: authUi.registerCode.value,
      password
    });
  });
  authUi.logout.addEventListener('click', async () => {
    authUi.logout.disabled = true; authUi.error.textContent = '';
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      renderAccount(null); await refreshDownloadAccess(); closeModal(); notify('已安全退出登录');
    } catch (error) {
      authUi.error.textContent = error.message;
    } finally {
      authUi.logout.disabled = false;
    }
  });
  authUi.checkoutClose.addEventListener('click', closeCheckout);
  authUi.checkoutModal.addEventListener('click', event => { if (event.target === authUi.checkoutModal) closeCheckout(); });
  authUi.guestCheckout.addEventListener('click', () => openRewardCheckout(false));
  authUi.replacePaymentOrder.addEventListener('click', async () => {
    const order = paymentOwner === 'guest' ? guestOrder : accountOrder;
    if (!order || !['pending', 'rejected'].includes(order.status)) return;
    if (!await confirmReplaceOrder()) return;
    authUi.replacePaymentOrder.disabled = true;
    try {
      if (paymentOwner === 'guest') await openRewardCheckout(true);
      else await openAccountRewardCheckout(order.kind, order.amountFen, true);
    } finally {
      authUi.replacePaymentOrder.disabled = false;
    }
  });
  authUi.rewardBack.addEventListener('click', () => {
    clearInterval(guestOrderPollTimer); guestOrderPollTimer = null;
    clearInterval(guestOrderCountdownTimer); guestOrderCountdownTimer = null;
    authUi.rewardCheckout.hidden = true;
    if (checkoutMode === 'recharge') authUi.rechargeSetup.hidden = false;
    else { authUi.checkoutOptions.hidden = false; authUi.checkoutNotice.hidden = false; }
  });
  authUi.rewardProof.addEventListener('change', () => {
    paymentStatusOverride = '';
    const activeOrder = paymentOwner === 'guest' ? guestOrder : accountOrder;
    if (activeOrder) authUi.rewardStatus.textContent = paymentOrderStatusText(activeOrder);
    const file = authUi.rewardProof.files && authUi.rewardProof.files[0];
    rewardProofDataUrl = ''; authUi.rewardProofPreview.hidden = true;
    authUi.rewardProofName.textContent = '尚未选择截图';
    authUi.rewardProofName.classList.remove('has-file');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      paymentStatusOverride = '请选择不超过 2 MB 的 PNG、JPG 或 WEBP 截图';
      authUi.rewardStatus.textContent = paymentStatusOverride; authUi.rewardProof.value = ''; return;
    }
    authUi.rewardProofName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(file.size >= 1024 * 1024 ? 2 : 1)} MB`;
    authUi.rewardProofName.classList.add('has-file');
    const reader = new FileReader();
    reader.onload = () => {
      rewardProofDataUrl = String(reader.result || '');
      authUi.rewardProofPreview.src = rewardProofDataUrl;
      authUi.rewardProofPreview.hidden = false;
      requestAnimationFrame(() => authUi.submitRewardProof.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    };
    reader.onerror = () => {
      paymentStatusOverride = '无法读取付款截图';
      authUi.rewardStatus.textContent = paymentStatusOverride;
    };
    reader.readAsDataURL(file);
  });
  authUi.submitRewardProof.addEventListener('click', async () => {
    if (!rewardProofDataUrl) {
      paymentStatusOverride = '请先选择付款截图';
      authUi.rewardStatus.textContent = paymentStatusOverride;
      return;
    }
    paymentStatusOverride = '';
    authUi.submitRewardProof.disabled = true; authUi.rewardStatus.textContent = '正在识别截图中的付款金额和时间…';
    try {
      const endpoint = paymentOwner === 'guest' ? '/api/payments/guest/order/submit' : '/api/payments/account/order/submit';
      const body = { paymentReference: authUi.rewardReference.value, proofDataUrl: rewardProofDataUrl };
      if (paymentOwner === 'account') body.orderId = accountOrder.id;
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      renderPaymentOrder(result.order, paymentOwner); notify(result.message);
      if (result.user) renderAccount(result.user);
      if (paymentOwner === 'guest' && result.order.status === 'paid') await authorizeGuestDownload();
      else if (paymentOwner === 'account' && result.order.kind === 'own_pdf' && result.order.status === 'paid') await authorizeAccountDownload();
      else if (paymentOwner === 'account' && result.order.kind === 'recharge' && result.order.balanceCredited) {
        closeCheckout(); notify(result.message);
      } else startGuestOrderPolling();
    } catch (error) {
      if (paymentOwner === 'account' && error.code === 'PAYMENT_AMOUNT_MISMATCH' && error.order) {
        renderPaymentOrder(error.order, 'account');
        resetPaymentProof();
      }
      paymentStatusOverride = error.message;
      authUi.rewardStatus.textContent = paymentStatusOverride;
    }
    finally { authUi.submitRewardProof.disabled = false; }
  });
  authUi.confirmRewardPaid.addEventListener('click', async () => {
    authUi.confirmRewardPaid.disabled = true; authUi.rewardStatus.textContent = '正在确认并生成 PDF…';
    try {
      const result = await api('/api/payments/guest/order/self-confirm', { method: 'POST', body: '{}' });
      renderPaymentOrder(result.order, 'guest'); await authorizeGuestDownload();
    } catch (error) { authUi.rewardStatus.textContent = error.message; }
    finally { authUi.confirmRewardPaid.disabled = false; }
  });
  authUi.refreshRewardStatus.addEventListener('click', () => refreshGuestOrder(false));
  authUi.accountCheckout.addEventListener('click', async () => {
    if (currentUser && currentUser.isSuperuser && pendingDownload) {
      const authorizedDownload = pendingDownload; pendingDownload = null; closeCheckout();
      authorizedDownload(); notify('超级账户测试权限：本次下载免费'); return;
    }
    if (!currentUser) { closeCheckout(); openModal(); return; }
    if (!pendingDownload) return;
    const authorizedDownload = pendingDownload;
    authUi.accountCheckout.disabled = true;
    try {
      let orderId = pendingAccountDownloadOrderId;
      if (!orderId) {
        const result = await api('/api/payments/account/balance-download', { method: 'POST', body: '{}' });
        renderAccount(result.user);
        orderId = result.order && result.order.id;
        pendingAccountDownloadOrderId = orderId || '';
      }
      pendingDownload = null;
      if (orderId) {
        const access = await api('/api/payments/account/order/consume', { method: 'POST', body: JSON.stringify({ orderId }) });
        activateDownloadAccess(access.accessExpiresAt);
      }
      await Promise.resolve(authorizedDownload());
      pendingAccountDownloadOrderId = '';
      closeCheckout(); notify('PDF 已下载；本次付款获得的 2 分钟下载权限仍然有效');
    } catch (error) {
      pendingDownload = authorizedDownload;
      if (error.code === 'INSUFFICIENT_BALANCE') showBalanceInsufficient(error);
      else notify(error.message);
    }
    finally { authUi.accountCheckout.disabled = false; }
  });
  authUi.memberRewardCheckout.addEventListener('click', () => openAccountRewardCheckout('own_pdf', pricing.memberOwnPdfFen));
  authUi.checkoutRecharge.addEventListener('click', openRechargeCheckout);
  authUi.openRecharge.addEventListener('click', openRechargeCheckout);
  authUi.balanceInsufficientClose.addEventListener('click', closeBalanceInsufficient);
  authUi.balanceInsufficientCancel.addEventListener('click', closeBalanceInsufficient);
  authUi.balanceInsufficientModal.addEventListener('click', event => { if (event.target === authUi.balanceInsufficientModal) closeBalanceInsufficient(); });
  authUi.insufficientRecharge.addEventListener('click', () => { closeBalanceInsufficient(); openRechargeCheckout(); });
  authUi.insufficientDirectPay.addEventListener('click', () => { closeBalanceInsufficient(); openAccountRewardCheckout('own_pdf', pricing.memberOwnPdfFen); });
  authUi.cancelRecharge.addEventListener('click', closeCheckout);
  document.querySelectorAll('.recharge-presets button').forEach(button => button.addEventListener('click', () => {
    const fen = Number(button.dataset.fen);
    authUi.rechargeAmount.value = (fen / 100).toFixed(2);
    authUi.checkoutPrice.textContent = formatFen(fen);
    document.querySelectorAll('.recharge-presets button').forEach(item => item.classList.toggle('active', item === button));
  }));
  authUi.rechargeAmount.addEventListener('input', () => {
    const fen = Math.round(Number(authUi.rechargeAmount.value || 0) * 100);
    authUi.checkoutPrice.textContent = Number.isFinite(fen) && fen > 0 ? formatFen(fen) : '—';
    document.querySelectorAll('.recharge-presets button').forEach(item => item.classList.remove('active'));
  });
  authUi.createRechargeOrder.addEventListener('click', () => {
    const amountFen = Math.round(Number(authUi.rechargeAmount.value) * 100);
    if (!Number.isInteger(amountFen) || amountFen < 100 || amountFen > 50000) { notify('充值金额须为 1.00 至 500.00 元'); return; }
    openAccountRewardCheckout('recharge', amountFen);
  });
  authUi.adminReviewButton.addEventListener('click', () => {
    closeModal(); authUi.adminReviewModal.hidden = false; document.body.classList.add('modal-open'); refreshAdminOrders();
  });
  authUi.adminReviewClose.addEventListener('click', closeAdminReview);
  authUi.adminReviewModal.addEventListener('click', event => { if (event.target === authUi.adminReviewModal) closeAdminReview(); });
  authUi.refreshGuestOrders.addEventListener('click', refreshAdminOrders);
  authUi.approveGuestOrder.addEventListener('click', () => reviewSelectedGuestOrder('approve'));
  authUi.rejectGuestOrder.addEventListener('click', () => reviewSelectedGuestOrder('reject'));
  authUi.uploadRewardCode.addEventListener('click', async () => {
    const file = authUi.rewardAdminFile.files && authUi.rewardAdminFile.files[0];
    if (!file) { authUi.rewardAdminStatus.textContent = '请先选择赞赏码原图'; return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      authUi.rewardAdminStatus.textContent = '请选择不超过 8 MB 的 PNG、JPG 或 WEBP 原图'; return;
    }
    authUi.uploadRewardCode.disabled = true; authUi.rewardAdminStatus.textContent = '正在保存赞赏码原图…';
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('无法读取赞赏码图片')); reader.readAsDataURL(file);
      });
      const result = await api('/api/admin/reward-code', { method: 'POST', body: JSON.stringify({ imageDataUrl }) });
      rewardCodeStatus = result.rewardCode; authUi.guestCheckout.disabled = false;
      authUi.memberRewardCheckout.disabled = false; authUi.createRechargeOrder.disabled = false;
      authUi.guestCheckoutHint.textContent = '赞赏码付款 · 通过后 2 分钟可重复下载';
      authUi.rewardAdminStatus.textContent = result.message; authUi.rewardAdminFile.value = ''; notify(result.message);
    } catch (error) { authUi.rewardAdminStatus.textContent = error.message; }
    finally { authUi.uploadRewardCode.disabled = false; }
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
    if (!authUi.balanceInsufficientModal.hidden) closeBalanceInsufficient();
    else if (!authUi.adminReviewModal.hidden) closeAdminReview();
    else if (!authUi.checkoutModal.hidden) closeCheckout();
    else if (!authUi.resetModal.hidden) closeResetModal();
    else if (!feedbackUi.modal.hidden) closeFeedbackModal();
    else if (!authUi.modal.hidden) closeModal();
  });

  window.PindouBilling = Object.freeze({ requestOwnDownload: openCheckout, guestOwnPdfFen: 20, memberOwnPdfFen: 10 });
  window.PindouCloudDraft = Object.freeze({
    queueSave: queueCloudDraft,
    save: saveCloudDraft,
    remove: removeCloudDraft,
    refresh: refreshCloudDraft
  });

  api('/api/auth/me')
    .then(result => { renderPricing(result.pricing); renderAccount(result.user); return refreshDownloadAccess(); })
    .catch(() => { renderAccount(null); return refreshDownloadAccess(); });
  api('/api/auth/config')
    .then(result => {
      verificationStatus = result.verification || verificationStatus;
      securityQuestions = Array.isArray(result.securityQuestions) ? result.securityQuestions : [];
      authUi.securityQuestionSelect.replaceChildren(...securityQuestions.map(question => {
        const option = document.createElement('option'); option.value = question.id; option.textContent = question.text; return option;
      }));
      authUi.saveSecurityQuestion.disabled = securityQuestions.length === 0;
      const available = [verificationStatus.emailConfigured && '邮箱'].filter(Boolean);
      authUi.resetProviderStatus.textContent = available.length
        ? `${verificationStatus.mode === 'console' ? '本地测试模式：' : ''}可使用邮箱验证码；已设置用户也可使用验证问题。`
        : '邮箱服务尚未配置；已设置用户仍可使用验证问题。';
      authUi.sendRegisterCode.disabled = !verificationStatus.emailConfigured;
      authUi.registerCodeStatus.textContent = verificationStatus.emailConfigured
        ? `${verificationStatus.mode === 'console' ? '本地测试模式：' : ''}邮箱验证码服务可用。`
        : '邮箱验证码服务尚未配置，暂时无法注册新账号。';
    })
    .catch(() => {
      authUi.resetProviderStatus.textContent = '无法读取验证码服务状态';
      authUi.registerCodeStatus.textContent = '无法读取邮箱服务状态';
      authUi.sendRegisterCode.disabled = true;
    });
  api('/api/billing/config')
    .then(result => {
      renderPricing(result.pricing);
      rewardCodeStatus = result.rewardCode || rewardCodeStatus;
      authUi.guestCheckout.disabled = !rewardCodeStatus.configured;
      authUi.memberRewardCheckout.disabled = !rewardCodeStatus.configured;
      authUi.createRechargeOrder.disabled = !rewardCodeStatus.configured;
      authUi.guestCheckoutHint.textContent = rewardCodeStatus.configured
        ? '2 分钟付款 · 额外 5 分钟上传截图'
        : '请把赞赏码原图保存为 data/reward-code.png';
    })
    .catch(() => { authUi.guestCheckoutHint.textContent = '无法读取赞赏码配置'; });
})();
