// ■■■ ここにGASで発行されたウェブアプリのURLを貼り付けます ■■■
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxBiVm8Eke_HBb4oqrf9Ju3dNMexVybyoS17geB10KyYH6IE8UghBwW2wJ2eyq5q4_3/exec';

let transactions = []; // スプレッドシートから取得したデータを保持

const totalBalanceEl = document.getElementById('total-balance');
const historyListEl = document.getElementById('history-list');
const modalOverlay = document.getElementById('transaction-modal');
const txForm = document.getElementById('transaction-form');
const txDateInput = document.getElementById('tx-date');
const loadingEl = document.getElementById('loading-spinner');
const btnSubmit = document.getElementById('btn-submit');

// 初期表示
document.addEventListener('DOMContentLoaded', () => {
  // 日付の初期値を今日にセット
  const now = new Date();
  const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  txDateInput.value = today;
  
  // スマホなどでの引っ張り更新を防ぐ設定
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

// アプリケーション描画処理
function renderApp() {
  if (loadingEl) loadingEl.style.display = 'none';

  // 残高計算
  const total = transactions.reduce((acc, tx) => {
    return tx.type === 'income' ? acc + tx.amount : acc - tx.amount;
  }, 0);

  // 数値フォーマット（カンマ区切り）
  totalBalanceEl.textContent = total.toLocaleString();

  // 履歴リスト描画（新しい順）
  // ※DOMの再取得は不要なので、既存の要素をクリアして再描画
  if (transactions.length === 0) {
    historyListEl.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
    return;
  }

  historyListEl.innerHTML = '';
  const sortedTx = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

  sortedTx.forEach(tx => {
    const isIncome = tx.type === 'income';
    const amountStr = (isIncome ? '+' : '-') + '¥' + tx.amount.toLocaleString();
    const amountClass = isIncome ? 'amount-positive' : 'amount-negative';
    
    // 日付フォーマット YYYY-MM-DDTHH:mm を読みやすく
    let displayDate = tx.date;
    try {
      if(tx.date) {
        // GASから "2023-11-20T14:30" などの形式が来るか、ISO形式が来る
        const d = new Date(tx.date);
        if(!isNaN(d)) {
          displayDate = d.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      }
    } catch(e) {}

    const itemHTML = `
      <div class="history-item" onclick="openEditModal('${tx.id}')">
        <div class="history-info">
          <div class="history-title">${tx.memo}</div>
          <div class="history-meta">
            <span>${displayDate}</span>
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

  document.getElementById('tx-id').value = '';
  document.getElementById('btn-delete').style.display = 'none';
  typeInput.value = type;

  if (type === 'income') {
    modalTitle.textContent = '入金（集金）を追加';
    btnSubmit.style.backgroundColor = 'var(--income-color)';
    btnSubmit.textContent = '入金を登録する';
  } else {
    modalTitle.textContent = '支出（利用）を追加';
    btnSubmit.style.backgroundColor = 'var(--expense-color)';
    btnSubmit.textContent = '支出を登録する';
  }

  // アニメーション表示
  modalOverlay.classList.add('active');
}

function closeModal(event) {
  if (event && event.target !== modalOverlay && event.type === 'click') return;
  modalOverlay.classList.remove('active');
  // フォームクリア
  setTimeout(() => {
    txForm.reset();
    document.getElementById('tx-id').value = '';
    document.getElementById('btn-delete').style.display = 'none';
    const now = new Date();
    txDateInput.value = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  }, 300);
}

// 編集モーダルのオープン
function openEditModal(id) {
  // idはGAS側で発行される場合StringやNumberなどが混ざるため緩い比較
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx) return;
  
  const modalTitle = document.getElementById('modal-title');
  const typeInput = document.getElementById('tx-type');
  const idInput = document.getElementById('tx-id');
  const amountInput = document.getElementById('tx-amount');
  const memoInput = document.getElementById('tx-memo');
  const btnDelete = document.getElementById('btn-delete');
  
  idInput.value = tx.id;
  typeInput.value = tx.type;
  
  // yyyy-MM-ddTHH:mm 形式に変換
  let dateVal = tx.date;
  if(dateVal) {
    const d = new Date(dateVal);
    if(!isNaN(d)) {
      dateVal = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    }
  }
  txDateInput.value = dateVal || '';
  
  amountInput.value = tx.amount;
  memoInput.value = tx.memo;
  
  if (tx.type === 'income') {
    modalTitle.textContent = '入金（集金）の編集';
    btnSubmit.style.backgroundColor = 'var(--income-color)';
    btnSubmit.textContent = '更新する';
  } else {
    modalTitle.textContent = '支出（利用）の編集';
    btnSubmit.style.backgroundColor = 'var(--expense-color)';
    btnSubmit.textContent = '更新する';
  }
  
  btnDelete.style.display = 'block'; // 削除ボタンを表示
  modalOverlay.classList.add('active');
}

// データ登録処理 (GASへのPOST通信)
async function submitTransaction(event) {
  event.preventDefault();
  
  if (!GAS_URL) {
    alert('GAS_URLが設定されていません');
    return;
  }

  const idValue = document.getElementById('tx-id').value;
  const type = document.getElementById('tx-type').value;
  const date = document.getElementById('tx-date').value;
  const amount = parseInt(document.getElementById('tx-amount').value, 10);
  const memo = document.getElementById('tx-memo').value;

  const isUpdate = idValue !== '';

  const newTx = {
    action: isUpdate ? 'update' : 'create',
    id: isUpdate ? idValue : Date.now(), // 既存IDか新規時刻
    date,
    type,
    amount,
    memo
  };

  // ボタンをローディング状態にする
  const originalBtnText = btnSubmit.textContent;
  btnSubmit.textContent = '送信中...';
  btnSubmit.disabled = true;
  btnSubmit.style.opacity = '0.7';

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify(newTx),
      headers: {
        "Content-Type": "text/plain;charset=utf-8", // GASのCORS回避仕様対応
      }
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
    // ボタンの状態を元に戻す
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
      method: "POST",
      body: JSON.stringify({ action: 'delete', id: idValue }),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
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

