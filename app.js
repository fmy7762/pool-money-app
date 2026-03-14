// ■■■ ここにGASで発行されたウェブアプリのURLを貼り付けます ■■■
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxBiVm8Eke_HBb4oqrf9Ju3dNMexVybyoS17geB10KyYH6IE8UghBwW2wJ2eyq5q4_3/exec';

let transactions = [];

const totalBalanceEl = document.getElementById('total-balance');
const historyListEl = document.getElementById('history-list');
const modalOverlay = document.getElementById('transaction-modal');
const settleModalOverlay = document.getElementById('settle-modal');
const txForm = document.getElementById('transaction-form');
const txDateInput = document.getElementById('tx-date');
const loadingEl = document.getElementById('loading-spinner');
const btnSubmit = document.getElementById('btn-submit');

let pendingSettleId = null; // 精算対象のID

// 初期表示
document.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  txDateInput.value = today;

  document.body.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
  document.querySelector('.app-container').addEventListener('touchmove', function(e) { e.stopPropagation(); }, { passive: false });
  document.querySelector('.modal-content').addEventListener('touchmove', function(e) { e.stopPropagation(); }, { passive: false });

  fetchData();
});

// GASからデータ取得
async function fetchData() {
  if (!GAS_URL) {
    loadingEl.textContent = 'GAS_URLが設定されていません。アプリにURLを登録してください。';
    return;
  }
  try {
    const res = await fetch(GAS_URL);
    if (!res.ok) throw new Error('Network response was not ok');
    transactions = await res.json();
    renderApp();
  } catch (error) {
    console.error('Error fetching data:', error);
    loadingEl.textContent = 'データの読み込みに失敗しました。時間をおいて再読み込みしてください。';
  }
}

// アプリ描画
function renderApp() {
  if (loadingEl) loadingEl.style.display = 'none';

  // 残高計算（立替は精算時に支出として計上するため、settled済みのもののみ反映）
  const total = transactions.reduce((acc, tx) => {
    if (tx.type === 'income') return acc + tx.amount;
    if (tx.type === 'expense') return acc - tx.amount;
    if (tx.type === 'settled') return acc - tx.amount; // 精算済み立替も支出として引く
    return acc;
  }, 0);

  totalBalanceEl.textContent = total.toLocaleString();

  // 未精算の立替リスト
  const advances = transactions.filter(tx => tx.type === 'advance');
  renderAdvances(advances);

  // 通常履歴（income / expense / settled）
  renderHistory();
}

// 未精算リストの描画
function renderAdvances(advances) {
  const section = document.getElementById('advance-section');
  const list = document.getElementById('advance-list');

  if (advances.length === 0) {
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

// 通常履歴の描画
function renderHistory() {
  const normalTx = transactions.filter(tx => tx.type !== 'advance');

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

    // 精算済みアーカイブのラベル
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

// モーダル操作
function openModal(type) {
  const modalTitle = document.getElementById('modal-title');
  const typeInput = document.getElementById('tx-type');
  const payerGroup = document.getElementById('form-group-payer');
  const payerInput = document.getElementById('tx-payer');

  document.getElementById('tx-id').value = '';
  document.getElementById('btn-delete').style.display = 'none';
  typeInput.value = type;

  // 立替者フィールドの表示切替
  if (type === 'advance') {
    payerGroup.style.display = 'block';
    payerInput.required = true;
    modalTitle.textContent = '立替を追加';
    btnSubmit.style.backgroundColor = 'var(--advance-color, #f59e0b)';
    btnSubmit.textContent = '立替を登録する';
  } else {
    payerGroup.style.display = 'none';
    payerInput.required = false;
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
    const now = new Date();
    txDateInput.value = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  }, 300);
}

// 精算モーダル
function openSettleModal(id) {
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx) return;

  pendingSettleId = id;

  const infoEl = document.getElementById('settle-info');
  infoEl.innerHTML = `
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

// 精算実行
async function confirmSettle() {
  if (!pendingSettleId) return;

  const tx = transactions.find(t => String(t.id) === String(pendingSettleId));
  if (!tx) return;

  const btnConfirm = document.getElementById('btn-settle-confirm');
  btnConfirm.textContent = '精算中...';
  btnConfirm.disabled = true;

  const now = new Date();
  const settleDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

  // GASに2つのアクションを送る：
  // 1. 立替レコードを削除
  // 2. 精算済みとして expense レコードを新規作成
  const settledTx = {
    action: 'settle',
    originalId: tx.id,
    id: Date.now(),
    date: settleDate,
    type: 'settled',
    amount: tx.amount,
    memo: tx.memo,
    payer: tx.payer || ''
  };

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify(settledTx),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    const result = await response.json();

    if (result.status === 'success') {
      // ローカルのデータを更新
      transactions = transactions.filter(t => String(t.id) !== String(tx.id));
      transactions.push({
        ...settledTx,
        action: undefined
      });
      renderApp();
      closeSettleModal();
    } else {
      throw new Error(result.message || 'Server error');
    }
  } catch (error) {
    console.error('Settle failed:', error);
    alert('精算に失敗しました。ネットワークを確認してください。');
  } finally {
    btnConfirm.textContent = '精算する';
    btnConfirm.disabled = false;
  }
}

// 編集モーダル
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

  let dateVal = tx.date;
  if (dateVal) {
    const d = new Date(dateVal);
    if (!isNaN(d)) {
      dateVal = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    }
  }
  txDateInput.value = dateVal || '';
  amountInput.value = tx.amount;
  memoInput.value = tx.memo;

  if (tx.type === 'advance') {
    payerGroup.style.display = 'block';
    payerInput.required = true;
    payerInput.value = tx.payer || '';
    modalTitle.textContent = '立替の編集';
    btnSubmit.style.backgroundColor = 'var(--advance-color, #f59e0b)';
  } else if (tx.type === 'income') {
    payerGroup.style.display = 'none';
    payerInput.required = false;
    modalTitle.textContent = '入金（集金）の編集';
    btnSubmit.style.backgroundColor = 'var(--income-color)';
  } else {
    payerGroup.style.display = 'none';
    payerInput.required = false;
    modalTitle.textContent = '支出（利用）の編集';
    btnSubmit.style.backgroundColor = 'var(--expense-color)';
  }

  btnSubmit.textContent = '更新する';
  btnDelete.style.display = 'block';
  modalOverlay.classList.add('active');
}

// データ登録
async function submitTransaction(event) {
  event.preventDefault();

  if (!GAS_URL) { alert('GAS_URLが設定されていません'); return; }

  const idValue = document.getElementById('tx-id').value;
  const type = document.getElementById('tx-type').value;
  const date = document.getElementById('tx-date').value;
  const amount = parseInt(document.getElementById('tx-amount').value, 10);
  const memo = document.getElementById('tx-memo').value;
  const payer = document.getElementById('tx-payer').value;
  const isUpdate = idValue !== '';

  const newTx = {
    action: isUpdate ? 'update' : 'create',
    id: isUpdate ? idValue : Date.now(),
    date, type, amount, memo,
    payer: type === 'advance' ? payer : ''
  };

  const originalBtnText = btnSubmit.textContent;
  btnSubmit.textContent = '送信中...';
  btnSubmit.disabled = true;
  btnSubmit.style.opacity = '0.7';

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify(newTx),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    const result = await response.json();

    if (result.status === 'success') {
      if (isUpdate) {
        const index = transactions.findIndex(t => String(t.id) === String(newTx.id));
        if (index > -1) transactions[index] = newTx;
      } else {
        transactions.push(newTx);
      }
      renderApp();
      closeModal();
    } else {
      throw new Error(result.message || 'Server returned an error');
    }
  } catch (error) {
    console.error('Submission failed', error);
    alert('登録に失敗しました。ネットワークを確認してください。');
  } finally {
    btnSubmit.textContent = originalBtnText;
    btnSubmit.disabled = false;
    btnSubmit.style.opacity = '1';
  }
}

// 削除処理
async function deleteTransaction() {
  const idValue = document.getElementById('tx-id').value;
  if (!idValue) return;
  if (!confirm('この履歴を削除してもよろしいですか？')) return;
  if (!GAS_URL) return;

  const originalBtnText = btnSubmit.textContent;
  btnSubmit.textContent = '削除中...';
  btnSubmit.disabled = true;
  document.getElementById('btn-delete').disabled = true;

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id: idValue }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    const result = await response.json();

    if (result.status === 'success') {
      transactions = transactions.filter(t => String(t.id) !== String(idValue));
      renderApp();
      closeModal();
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Delete failed', error);
    alert('削除に失敗しました。ネットワークを確認してください。');
  } finally {
    btnSubmit.textContent = originalBtnText;
    btnSubmit.disabled = false;
    document.getElementById('btn-delete').disabled = false;
  }
}

// ユーティリティ
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d)) {
      return d.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch(e) {}
  return dateStr;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
