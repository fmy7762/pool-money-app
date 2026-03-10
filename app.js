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
  const today = new Date().toISOString().split('T')[0];
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
    const displayDate = tx.date.split('T')[0]; // yyyy-MM-ddの抽出

    const itemHTML = `
      <div class="history-item">
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
    const today = new Date().toISOString().split('T')[0];
    txDateInput.value = today;
  }, 300);
}

// データ登録処理 (GASへのPOST通信)
async function submitTransaction(event) {
  event.preventDefault();
  
  if (!GAS_URL) {
    alert('GAS_URLが設定されていません');
    return;
  }

  const type = document.getElementById('tx-type').value;
  const date = document.getElementById('tx-date').value;
  const amount = parseInt(document.getElementById('tx-amount').value, 10);
  const memo = document.getElementById('tx-memo').value;

  const newTx = {
    id: Date.now(),
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
      // 成功した場合、ローカルの配列にも追加して画面を即時更新
      transactions.push(newTx);
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
