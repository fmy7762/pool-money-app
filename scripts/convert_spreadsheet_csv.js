#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.output || !args.groupId || !args.createdBy) {
  console.error('Usage: node scripts/convert_spreadsheet_csv.js --input transactions.csv --output supabase_expenses.csv --group-id <uuid> --created-by <auth-user-uuid>');
  process.exit(1);
}

const input = fs.readFileSync(args.input, 'utf8');
const rows = parseCsv(input);
if (rows.length < 2) {
  console.error('CSV has no data rows.');
  process.exit(1);
}

const headers = rows[0].map(value => value.trim());
const records = rows.slice(1)
  .filter(row => row.some(value => value.trim() !== ''))
  .map(row => rowToObject(headers, row))
  .map(record => convertRecord(record, args.groupId, args.createdBy));

const outputHeaders = [
  'id',
  'group_id',
  'expense_date',
  'expense_time',
  'amount',
  'category',
  'description',
  'paid_by',
  'transaction_type',
  'created_by',
  'created_at',
  'updated_at',
  'deleted_at'
];

const output = [
  outputHeaders.join(','),
  ...records.map(record => outputHeaders.map(header => csvEscape(record[header] || '')).join(','))
].join('\n');

fs.writeFileSync(args.output, output, 'utf8');
console.log(`Wrote ${records.length} rows to ${path.resolve(args.output)}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--')) continue;
    parsed[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return parsed;
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] || '';
    return acc;
  }, {});
}

function convertRecord(record, groupId, createdBy) {
  const dateValue = record.date || record.expense_date || record.datetime || '';
  const { date, time } = splitDateTime(dateValue);
  const type = normalizeType(record.type || record.transaction_type || 'expense');
  const now = new Date().toISOString();

  return {
    id: isUuid(record.id) ? record.id : randomUUID(),
    group_id: groupId,
    expense_date: date,
    expense_time: time,
    amount: normalizeAmount(record.amount),
    category: record.category || categoryForType(type),
    description: record.memo || record.description || '',
    paid_by: record.payer || record.paid_by || '',
    transaction_type: type,
    created_by: createdBy,
    created_at: record.created_at || now,
    updated_at: record.updated_at || now,
    deleted_at: record.deleted_at || ''
  };
}

function splitDateTime(value) {
  if (!value) return { date: new Date().toISOString().slice(0, 10), time: '00:00:00' };
  const normalized = value.replace(' ', 'T');
  const localMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?/);
  if (localMatch) {
    const time = localMatch[2] || '00:00:00';
    return {
      date: localMatch[1],
      time: time.length === 5 ? `${time}:00` : time.slice(0, 8)
    };
  }

  const [date, time = '00:00:00'] = normalized.split('T');
  return {
    date,
    time: time.length === 5 ? `${time}:00` : time.slice(0, 8)
  };
}

function normalizeType(type) {
  if (['income', 'expense', 'advance', 'settled'].includes(type)) return type;
  if (type.includes('入金')) return 'income';
  if (type.includes('立替')) return 'advance';
  if (type.includes('精算')) return 'settled';
  return 'expense';
}

function categoryForType(type) {
  if (type === 'income') return '入金';
  if (type === 'advance') return '立替';
  if (type === 'settled') return '精算済み';
  return '支出';
}

function normalizeAmount(value) {
  const amount = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount < 0) return '0';
  return amount.toFixed(2);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}
