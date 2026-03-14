// =====================================================
// GAS (Google Apps Script) 更新コード
// =====================================================
// 既存のGASコードを以下のコードに置き換えてください。
// 「シート名」の部分は実際のシート名に合わせてください。
// =====================================================

const SHEET_NAME = 'transactions'; // ← 実際のシート名に変更してください

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const transactions = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    // 数値変換
    obj.amount = Number(obj.amount) || 0;
    return obj;
  }).filter(tx => tx.id); // idが空の行を除外

  return ContentService
    .createTextOutput(JSON.stringify(transactions))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    
    // ヘッダー確認・作成
    ensureHeaders(sheet);

    if (data.action === 'create') {
      appendRow(sheet, data);
    } else if (data.action === 'update') {
      updateRow(sheet, data);
    } else if (data.action === 'delete') {
      deleteRow(sheet, data.id);
    } else if (data.action === 'settle') {
      // 1. 元の立替レコードを削除
      deleteRow(sheet, data.originalId);
      // 2. 精算済みレコードを追加
      appendRow(sheet, {
        id: data.id,
        date: data.date,
        type: 'settled',   // 精算済みとして記録
        amount: data.amount,
        memo: data.memo,
        payer: data.payer || ''
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ヘッダー行が存在しなければ作成（payerカラムを追加）
function ensureHeaders(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, 6).getValues()[0];
  if (!firstRow[0]) {
    sheet.getRange(1, 1, 1, 6).setValues([['id', 'date', 'type', 'amount', 'memo', 'payer']]);
  }
  // 既存シートにpayerカラムがない場合は追加
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!headers.includes('payer')) {
    const nextCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, nextCol).setValue('payer');
  }
}

function appendRow(sheet, data) {
  sheet.appendRow([
    data.id,
    data.date,
    data.type,
    data.amount,
    data.memo,
    data.payer || ''
  ]);
}

function updateRow(sheet, data) {
  const col = getIdColumn(sheet);
  const ids = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
  const rowIndex = ids.indexOf(String(data.id));
  if (rowIndex === -1) throw new Error('Row not found');

  const row = rowIndex + 2;
  sheet.getRange(row, 1, 1, 6).setValues([[
    data.id,
    data.date,
    data.type,
    data.amount,
    data.memo,
    data.payer || ''
  ]]);
}

function deleteRow(sheet, id) {
  const col = getIdColumn(sheet);
  const ids = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
  const rowIndex = ids.indexOf(String(id));
  if (rowIndex === -1) return; // 存在しない場合はスキップ
  sheet.deleteRow(rowIndex + 2);
}

function getIdColumn(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.indexOf('id') + 1;
}
