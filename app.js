const CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = CONFIG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY || '';

const REQUEST_TIMEOUT_MS = 15000;

let supabaseClient = null;
let currentUser = null;
let currentGroupId = null;
let transactions = [];
let pendingSettleId = null;
let isSubmitting = false;

const totalBalanceEl = document.getElementById('total-balance');
const historyListEl = document.getElementById('history-list');
const modalOverlay = document.getElementById('transaction-modal');
const settleModalOverlay = document.getElementById('settle-modal');
const txForm = document.getElementById('transaction-form');
const txDateInput = document.getElementById('tx-date');
const loadingEl = document.getElementById('loading-spinner');
const btnSubmit = document.getElementById('btn-submit');
const authPanelEl = document.getElementById('auth-panel');
const appContentEl = document.getElementById('app-content');
const userStatusEl = document.getElementById('user-status');
const messageEl = document.getElementById('app-message');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const btnSignIn = document.getElementById('btn-sign-in');
const btnSignUp = document.getElementById('btn-sign-up');
const btnSignOut = document.getElementById('btn-sign-out');
const actionButtons = Array.from(document.querySelectorAll('.action-buttons button'));

document.addEventListener('DOMContentLoaded', async () => {
  setDefaultDate();
  setupTouchHandling();
  setupNetworkListeners();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
    setAuthenticatedUi(false);
    showMessage('Supabase設定が見つかりません。config.jsを作成してください。', 'error', false);
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    showMessage('認証状態の確認に失敗しました。', 'error');
  }
  await handleSession(data ? data.session : null);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });
});

function setupTouchHandling() {
  document.body.addEventListener('touchmove', event => {
    event.preventDefault();
  }, { passive: false });

  document.querySelector('.app-container').addEventListener('touchmove', event => {
    event.stopPropagation();
  }, { passive: false });

  document.querySelectorAll('.modal-content').forEach(element => {
    element.addEventListener('touchmove', event => {
      event.stopPropagation();
    }, { passive: false });
  });
}

function setupNetworkListeners() {
  window.addEventListener('offline', () => {
    showMessage('オフラインのため保存できません。通信が戻ってから再試行してください。', 'warning', false);
  });

  window.addEventListener('online', () => {
    showMessage('オンラインに戻りました。最新データを取得します。', 'info');
    if (currentUser) fetchData();
  });
}

async function handleSession(session) {
  currentUser = session ? session.user : null;
  currentGroupId = null;
  transactions = [];

  if (!currentUser) {
    setAuthenticatedUi(false);
    renderApp();
    return;
  }

  setAuthenticatedUi(true);
  userStatusEl.textContent = currentUser.email || 'ログイン中';

  try {
    await ensureGroup();
    await fetchData();
  } catch (error) {
    console.error('Initial load failed:', error);
    showMessage(getSafeErrorMessage(error, '初期化に失敗しました。'), 'error', false);
  }
}

function setAuthenticatedUi(isAuthenticated) {
  authPanelEl.style.display = isAuthenticated ? 'none' : 'block';
  appContentEl.style.display = isAuthenticated ? 'block' : 'none';
  userStatusEl.style.display = isAuthenticated ? 'inline-flex' : 'none';
  btnSignOut.style.display = isAuthenticated ? 'inline-flex' : 'none';
  actionButtons.forEach(button => {
    button.disabled = !isAuthenticated;
  });
}

async function ensureGroup() {
  const { data, error } = await withTimeout(
    supabaseClient.rpc('ensure_default_group'),
    REQUEST_TIMEOUT_MS
  );

  if (error) throw error;
  if (!data) throw new Error('共有グループを取得できませんでした。');
  currentGroupId = data;
}

async function signIn() {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!validateAuthInput(email, password)) return;

  setAuthButtonsDisabled(true);
  try {
    const { error } = await withTimeout(
      supabaseClient.auth.signInWithPassword({ email, password }),
      REQUEST_TIMEOUT_MS
    );
    if (error) throw error;
    showMessage('ログインしました。', 'success');
  } catch (error) {
    console.error('Sign in failed:', error);
    showMessage(getSafeErrorMessage(error, 'ログインに失敗しました。'), 'error');
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signUp() {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!validateAuthInput(email, password)) return;

  setAuthButtonsDisabled(true);
  try {
    const { error } = await withTimeout(
      supabaseClient.auth.signUp({ email, password }),
      REQUEST_TIMEOUT_MS
    );
    if (error) throw error;
    showMessage('登録しました。確認メールが届いた場合はメール内のリンクを開いてください。', 'success', false);
  } catch (error) {
    console.error('Sign up failed:', error);
    showMessage(getSafeErrorMessage(error, 'ユーザー登録に失敗しました。'), 'error');
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showMessage('ログアウトに失敗しました。', 'error');
    return;
  }
  showMessage('ログアウトしました。', 'info');
}

function validateAuthInput(email, password) {
  if (!email || !password) {
    showMessage('メールアドレスとパスワードを入力してください。', 'warning');
    return false;
  }
  if (password.length < 6) {
    showMessage('パスワードは6文字以上で入力してください。', 'warning');
    return false;
  }
  return true;
}

function setAuthButtonsDisabled(disabled) {
  btnSignIn.disabled = disabled;
  btnSignUp.disabled = disabled;
}

async function refreshApp() {
  if (!currentUser) {
    showMessage('ログインしてください。', 'warning');
    return;
  }

  const btn = document.getElementById('refresh-btn');
  const icon = btn.querySelector('.material-icons-round');
  icon.style.transition = 'transform 0.6s ease';
  icon.style.transform = 'rotate(360deg)';
  btn.disabled = true;
  setTimeout(() => {
    icon.style.transform = '';
    icon.style.transition = '';
  }, 600);

  await fetchData();
  btn.disabled = false;
}

async function fetchData() {
  if (!currentGroupId) return;
  if (loadingEl) {
    loadingEl.style.display = 'block';
    loadingEl.textContent = 'データを読み込み中...';
  }

  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from('expenses')
        .select('*')
        .eq('group_id', currentGroupId)
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .order('expense_time', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      REQUEST_TIMEOUT_MS
    );

    if (error) throw error;
    transactions = (data || []).map(rowToTransaction);
    renderApp();
  } catch (error) {
    console.error('Error fetching data:', error);
    if (loadingEl) {
      loadingEl.textContent = 'データの読み込みに失敗しました。再読み込みしてください。';
    }
    showMessage(getSafeErrorMessage(error, 'データの読み込みに失敗しました。'), 'error');
  }
}

function renderApp() {
  if (loadingEl && transactions.length > 0) loadingEl.style.display = 'none';

  const total = transactions.reduce((acc, tx) => {
    if (tx.type === 'income') return acc + tx.amount;
    if (tx.type === 'expense') return acc - tx.amount;
    if (tx.type === 'settled') return acc - tx.amount;
    return acc;
  }, 0);

  totalBalanceEl.textContent = total.toLocaleString();
  renderAdvances(transactions.filter(tx => tx.type === 'advance'));
  renderHistory();
}

function renderAdvances(advances) {
  const section = document.getElementById('advance-section');
  const list = document.getElementById('advance-list');

  if (!currentUser || advances.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '';

  advances.forEach(tx => {
    const itemHTML = `
      <div class="advance-item" id="advance-${tx.id}">
        <div class="advance-info">
          <div class="advance-payer">
            <span class="material-icons-round" style="font-size:1em;vertical-align:-2px;">person</span>
            ${escapeHtml(tx.payer || '不明')}
          </div>
          <div class="advance-memo">${escapeHtml(tx.memo)}</div>
          <div class="advance-date">${formatDate(tx.date)}</div>
        </div>
        <div class="advance-right">
          <div class="advance-amount">¥${tx.amount.toLocaleString()}</div>
          <button class="btn-settle-item" onclick="openSettleModal('${tx.id}')">
            <span class="material-icons-round">check_circle</span>
            精算
          </button>
        </div>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', itemHTML);
  });
}

function renderHistory() {
  const normalTx = transactions.filter(tx => tx.type !== 'advance');

  if (!currentUser) {
    historyListEl.innerHTML = '';
    return;
  }

  if (normalTx.length === 0) {
    historyListEl.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
    return;
  }

  historyListEl.innerHTML = '';
  const sorted = [...normalTx].sort((a, b) => new Date(b.date) - new Date(a.date));

  sorted.forEach(tx => {
    const isIncome = tx.type === 'income';
    const isSettled = tx.type === 'settled';
    const amountStr = (isIncome ? '+' : '-') + '¥' + tx.amount.toLocaleString();
    const amountClass = isIncome ? 'amount-positive' : 'amount-negative';
    const settledBadge = isSettled
      ? `<span class="settled-badge"><span class="material-icons-round" style="font-size:0.85em;vertical-align:-1px;">check</span> 精算済み</span>`
      : '';
    const payerInfo = isSettled && tx.payer
      ? `<span class="history-payer">${escapeHtml(tx.payer)} の立替</span>`
      : '';

    const itemHTML = `
      <div class="history-item ${isSettled ? 'settled-item' : ''}" onclick="${isSettled ? '' : `openEditModal('${tx.id}')`}">
        <div class="history-info">
          <div class="history-title">${escapeHtml(tx.memo)} ${settledBadge}</div>
          <div class="history-meta">
            <span>${formatDate(tx.date)}</span>
            ${payerInfo}
          </div>
        </div>
        <div class="history-amount ${amountClass}">${amountStr}</div>
      </div>
    `;
    historyListEl.insertAdjacentHTML('beforeend', itemHTML);
  });
}

function openModal(type) {
  if (!currentUser) {
    showMessage('ログインしてください。', 'warning');
    return;
  }

  const modalTitle = document.getElementById('modal-title');
  const typeInput = document.getElementById('tx-type');
  const payerGroup = document.getElementById('form-group-payer');
  const payerInput = document.getElementById('tx-payer');

  document.getElementById('tx-id').value = '';
  document.getElementById('btn-delete').style.display = 'none';
  typeInput.value = type;

  if (type === 'advance') {
    payerGroup.style.display = 'block';
    payerInput.required = true;
    modalTitle.textContent = '立替を追加';
    btnSubmit.style.backgroundColor = 'var(--advance-color, #FFB74D)';
    btnSubmit.textContent = '立替を登録する';
  } else {
    payerGroup.style.display = 'none';
    payerInput.required = false;
    payerInput.value = '';
    if (type === 'income') {
      modalTitle.textContent = '入金（集金）を追加';
      btnSubmit.style.backgroundColor = 'var(--income-color)';
      btnSubmit.textContent = '入金を登録する';
    } else {
      modalTitle.textContent = '支出（利用）を追加';
      btnSubmit.style.backgroundColor = 'var(--expense-color)';
      btnSubmit.textContent = '支出を登録する';
    }
  }

  modalOverlay.classList.add('active');
}

function closeModal(event) {
  if (event && event.target !== modalOverlay && event.type === 'click') return;
  modalOverlay.classList.remove('active');
  setTimeout(() => {
    txForm.reset();
    document.getElementById('tx-id').value = '';
    document.getElementById('btn-delete').style.display = 'none';
    document.getElementById('form-group-payer').style.display = 'none';
    setDefaultDate();
  }, 300);
}

function openSettleModal(id) {
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx) return;

  pendingSettleId = id;
  document.getElementById('settle-info').innerHTML = `
    <div class="settle-detail">
      <div><span class="settle-label">立替者</span><span class="settle-value">${escapeHtml(tx.payer || '不明')}</span></div>
      <div><span class="settle-label">金額</span><span class="settle-value settle-amount">¥${tx.amount.toLocaleString()}</span></div>
      <div><span class="settle-label">用途</span><span class="settle-value">${escapeHtml(tx.memo)}</span></div>
    </div>
  `;
  settleModalOverlay.classList.add('active');
}

function closeSettleModal(event) {
  if (event && event.target !== settleModalOverlay && event.type === 'click') return;
  settleModalOverlay.classList.remove('active');
  pendingSettleId = null;
}

async function confirmSettle() {
  if (!pendingSettleId || isSubmitting) return;

  const btnConfirm = document.getElementById('btn-settle-confirm');
  const originalText = btnConfirm.textContent;
  btnConfirm.textContent = '精算中...';
  btnConfirm.disabled = true;
  isSubmitting = true;

  try {
    const { data, error } = await withTimeout(
      supabaseClient.rpc('settle_expense', { p_expense_id: pendingSettleId }),
      REQUEST_TIMEOUT_MS
    );

    if (error) throw error;
    if (!data) throw new Error('精算対象が見つかりませんでした。');

    closeSettleModal();
    showMessage('精算しました。', 'success');
    await fetchData();
  } catch (error) {
    console.error('Settle failed:', error);
    showMessage(getSafeErrorMessage(error, '精算に失敗しました。'), 'error');
  } finally {
    btnConfirm.textContent = originalText;
    btnConfirm.disabled = false;
    isSubmitting = false;
  }
}

function openEditModal(id) {
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx) return;

  const modalTitle = document.getElementById('modal-title');
  const typeInput = document.getElementById('tx-type');
  const idInput = document.getElementById('tx-id');
  const amountInput = document.getElementById('tx-amount');
  const memoInput = document.getElementById('tx-memo');
  const btnDelete = document.getElementById('btn-delete');
  const payerGroup = document.getElementById('form-group-payer');
  const payerInput = document.getElementById('tx-payer');

  idInput.value = tx.id;
  typeInput.value = tx.type;
  txDateInput.value = toDateTimeLocal(tx.date);
  amountInput.value = tx.amount;
  memoInput.value = tx.memo;

  if (tx.type === 'advance') {
    payerGroup.style.display = 'block';
    payerInput.required = true;
    payerInput.value = tx.payer || '';
    modalTitle.textContent = '立替の編集';
    btnSubmit.style.backgroundColor = 'var(--advance-color, #FFB74D)';
  } else if (tx.type === 'income') {
    payerGroup.style.display = 'none';
    payerInput.required = false;
    payerInput.value = '';
    modalTitle.textContent = '入金（集金）の編集';
    btnSubmit.style.backgroundColor = 'var(--income-color)';
  } else {
    payerGroup.style.display = 'none';
    payerInput.required = false;
    payerInput.value = '';
    modalTitle.textContent = '支出（利用）の編集';
    btnSubmit.style.backgroundColor = 'var(--expense-color)';
  }

  btnSubmit.textContent = '更新する';
  btnDelete.style.display = 'block';
  modalOverlay.classList.add('active');
}

async function submitTransaction(event) {
  event.preventDefault();
  if (isSubmitting) return;
  if (!navigator.onLine) {
    showMessage('オフラインのため保存できません。', 'warning');
    return;
  }

  const formData = getTransactionFormData();
  if (!formData) return;

  const originalBtnText = btnSubmit.textContent;
  btnSubmit.textContent = '送信中...';
  btnSubmit.disabled = true;
  btnSubmit.style.opacity = '0.7';
  isSubmitting = true;

  try {
    if (formData.id) {
      await updateTransaction(formData);
      showMessage('更新しました。', 'success');
    } else {
      await createTransaction(formData);
      showMessage('登録しました。', 'success');
    }

    await fetchData();
    closeModal();
  } catch (error) {
    console.error('Submission failed:', error);
    showMessage(getSafeErrorMessage(error, '保存に失敗しました。'), 'error');
  } finally {
    btnSubmit.textContent = originalBtnText;
    btnSubmit.disabled = false;
    btnSubmit.style.opacity = '1';
    isSubmitting = false;
  }
}

function getTransactionFormData() {
  const id = document.getElementById('tx-id').value;
  const type = document.getElementById('tx-type').value;
  const date = document.getElementById('tx-date').value;
  const amountValue = document.getElementById('tx-amount').value;
  const memo = document.getElementById('tx-memo').value.trim();
  const payer = document.getElementById('tx-payer').value.trim();
  const amount = Number(amountValue);

  if (!date) {
    showMessage('日時を入力してください。', 'warning');
    return null;
  }
  if (amountValue === '' || !Number.isFinite(amount) || amount < 0) {
    showMessage('金額は0以上の数値で入力してください。', 'warning');
    return null;
  }
  if (!memo) {
    showMessage('用途・メモを入力してください。', 'warning');
    return null;
  }
  if (type === 'advance' && !payer) {
    showMessage('立替者の名前を入力してください。', 'warning');
    return null;
  }

  return { id, type, date, amount, memo, payer };
}

async function createTransaction(formData) {
  const payload = formDataToExpensePayload(formData);
  const { data, error } = await withTimeout(
    supabaseClient
      .from('expenses')
      .insert(payload)
      .select('*')
      .single(),
    REQUEST_TIMEOUT_MS
  );

  if (error) throw error;
  if (!data || !data.id) throw new Error('登録結果を確認できませんでした。');
}

async function updateTransaction(formData) {
  const payload = formDataToExpensePayload(formData);
  const { data, error } = await withTimeout(
    supabaseClient
      .from('expenses')
      .update(payload)
      .eq('id', formData.id)
      .eq('group_id', currentGroupId)
      .is('deleted_at', null)
      .select('*'),
    REQUEST_TIMEOUT_MS
  );

  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error('対象データが見つかりません。最新データを再読み込みしてください。');
  }
}

async function deleteTransaction() {
  const idValue = document.getElementById('tx-id').value;
  if (!idValue || isSubmitting) return;
  if (!confirm('この履歴を削除してもよろしいですか？')) return;

  const btnDelete = document.getElementById('btn-delete');
  const originalBtnText = btnSubmit.textContent;
  btnSubmit.textContent = '削除中...';
  btnSubmit.disabled = true;
  btnDelete.disabled = true;
  isSubmitting = true;

  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from('expenses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', idValue)
        .eq('group_id', currentGroupId)
        .is('deleted_at', null)
        .select('*'),
      REQUEST_TIMEOUT_MS
    );

    if (error) throw error;
    if (!data || data.length !== 1) {
      throw new Error('削除対象が見つかりません。最新データを再読み込みしてください。');
    }

    showMessage('削除しました。', 'success');
    await fetchData();
    closeModal();
  } catch (error) {
    console.error('Delete failed:', error);
    showMessage(getSafeErrorMessage(error, '削除に失敗しました。'), 'error');
  } finally {
    btnSubmit.textContent = originalBtnText;
    btnSubmit.disabled = false;
    btnDelete.disabled = false;
    isSubmitting = false;
  }
}

function formDataToExpensePayload(formData) {
  const dateParts = parseDateTimeLocal(formData.date);
  return {
    group_id: currentGroupId,
    expense_date: dateParts.date,
    expense_time: dateParts.time,
    amount: formData.amount,
    category: getCategoryLabel(formData.type),
    description: formData.memo,
    paid_by: formData.type === 'advance' ? formData.payer : '',
    transaction_type: formData.type
  };
}

function rowToTransaction(row) {
  return {
    id: row.id,
    date: combineExpenseDateTime(row.expense_date, row.expense_time),
    type: row.transaction_type,
    amount: Number(row.amount) || 0,
    memo: row.description || '',
    payer: row.paid_by || '',
    updatedAt: row.updated_at
  };
}

function parseDateTimeLocal(value) {
  const [date, timeWithSeconds = '00:00'] = value.split('T');
  const time = timeWithSeconds.length === 5 ? `${timeWithSeconds}:00` : timeWithSeconds;
  return { date, time };
}

function combineExpenseDateTime(date, time) {
  if (!date) return '';
  return `${date}T${(time || '00:00:00').slice(0, 8)}`;
}

function getCategoryLabel(type) {
  if (type === 'income') return '入金';
  if (type === 'expense') return '支出';
  if (type === 'advance') return '立替';
  if (type === 'settled') return '精算済み';
  return 'その他';
}

function setDefaultDate() {
  const now = new Date();
  txDateInput.value = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  return dateStr;
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  }
  return value.slice(0, 16);
}

function showMessage(message, type = 'info', autoHide = true) {
  messageEl.textContent = message;
  messageEl.className = `app-message ${type}`;
  messageEl.style.display = 'block';

  if (autoHide) {
    window.clearTimeout(showMessage.timeoutId);
    showMessage.timeoutId = window.setTimeout(() => {
      messageEl.style.display = 'none';
    }, 4500);
  }
}

function getSafeErrorMessage(error, fallback) {
  const message = error && error.message ? String(error.message) : fallback;
  if (/jwt|token|key|password|secret/i.test(message)) return fallback;
  if (message.includes('Failed to fetch')) return '通信に失敗しました。ネットワークを確認してください。';
  if (message.includes('timeout')) return '通信がタイムアウトしました。時間をおいて再試行してください。';
  return message || fallback;
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.refreshApp = refreshApp;
window.openModal = openModal;
window.closeModal = closeModal;
window.openSettleModal = openSettleModal;
window.closeSettleModal = closeSettleModal;
window.confirmSettle = confirmSettle;
window.openEditModal = openEditModal;
window.submitTransaction = submitTransaction;
window.deleteTransaction = deleteTransaction;
window.signIn = signIn;
window.signUp = signUp;
window.signOut = signOut;
