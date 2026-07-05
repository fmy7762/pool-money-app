# プール金管理

スマホとPCから共同利用する経費管理PWAです。データ保存先はJSONBin / Google Apps ScriptからSupabaseへ移行しています。

## 構成

移行後の通常運用は次の構成です。

```text
GitHub Pages
  -> HTML / CSS / JavaScript
  -> Supabase JavaScript SDK
  -> Supabase Authentication
  -> Supabase PostgreSQL
```

Google Apps ScriptとGoogleスプレッドシートは通常運用では使いません。旧GASコードは `legacy/gas_code.js` に調査用として残しています。

## 変更内容

- `app.js`: JSONBinへの全件上書きを廃止し、Supabaseの1件単位の取得、登録、更新、ソフトデリート、精算RPCへ変更
- `index.html`: Supabase SDK、`config.js`、メール/パスワードログイン画面を追加
- `style.css`: ログイン、通知、ログアウト表示のスタイルを追加
- `sw.js`: Supabase API、認証通信、非GETリクエストをキャッシュしないよう修正
- `supabase/schema.sql`: テーブル、RLS、インデックス、トリガー、RPCを追加
- `.github/workflows/deploy-pages.yml`: Repository Secretsから `config.js` を生成してGitHub Pagesへデプロイ
- `scripts/convert_spreadsheet_csv.js`: 旧CSVをSupabaseインポート用CSVへ変換

## Supabaseセットアップ

1. Supabaseで新しいプロジェクトを作成します。
2. AuthenticationでEmail providerを有効にします。
3. 必要に応じて「Confirm email」を有効または無効にします。友人だけの小規模利用なら、招待後に確認メールを使う運用が安全です。
4. Supabase SQL Editorを開き、`supabase/schema.sql` の内容を貼り付けて実行します。
5. SQL実行後、アプリからユーザー登録またはログインします。

この実装は単一共有グループ方式です。ログイン後に `ensure_default_group()` が `Pool Money` グループを作成し、ログインユーザーを自動でメンバーに追加します。将来複数グループへ拡張する場合は、グループ作成/招待UIを追加し、`expenses.group_id` を選択できるようにします。

## RLS

全テーブルでRow Level Securityを有効にしています。

- 未ログインユーザーは経費データへアクセスできません。
- 認証済みユーザーは、自分が所属するグループのデータだけ閲覧、登録、更新できます。
- 削除は `deleted_at` に日時を入れるソフトデリートです。
- 操作履歴は `expense_audit_logs` に自動記録されます。
- `restore_expense(uuid)` RPCで削除済みデータを復元できます。

ブラウザにはSupabase anon keyを配置します。anon keyは公開Webアプリ上から確認可能です。キーを隠すことではなく、RLSでデータを保護することが重要です。`service_role` キーは絶対にブラウザ、GitHub、HTML、JavaScriptに置かないでください。

## GitHub Pages設定

GitHub Actionsから `config.js` を生成してデプロイします。

Repository SettingsのSecrets and variablesから、次のRepository Secretsを追加してください。

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

その後、Settings > PagesでSourceを「GitHub Actions」に設定します。`main` へpushすると `.github/workflows/deploy-pages.yml` が実行されます。

ローカル確認をする場合は、`config.example.js` を `config.js` にコピーし、Supabase Project URLとanon keyを入れてください。`config.js` は `.gitignore` に入っています。

## 既存データの移行

旧スプレッドシートまたは旧データをCSVで書き出します。列名は少なくとも次の旧形式に対応しています。

```text
id,date,type,amount,memo,payer
```

変換例:

```bash
node scripts/convert_spreadsheet_csv.js \
  --input transactions.csv \
  --output supabase_expenses.csv \
  --group-id <groups.id> \
  --created-by <auth.users.id>
```

`group-id` はSupabaseの `groups` テーブル、`created-by` は移行データの作成者として扱うユーザーIDです。変換後のCSVをSupabase Dashboardの `expenses` テーブルへインポートしてください。移行前に元データをバックアップし、移行後に件数と合計金額を確認してください。

## 動作確認

- 未ログインでは残高、履歴、登録ボタンが表示されない
- メールアドレスとパスワードで登録、ログイン、ログアウトできる
- 入金、支出、立替を登録できる
- 金額が空、文字列、負数の場合は保存されない
- 通信失敗時に成功表示が出ず、入力内容が残る
- 編集はUUIDで対象を更新する
- 削除は一覧から消えるが、DB上は `deleted_at` が入る
- 立替の精算で元の立替がソフトデリートされ、精算済み履歴が追加される
- Supabase APIレスポンスがService Workerにキャッシュされない

## よくあるエラー

- `Supabase設定が見つかりません`: `config.js` がない、またはSecretsから生成されていません。
- `login required`: ログインしていない状態でRPCやDB操作を実行しています。
- `not allowed`: 対象グループのメンバーではありません。
- GitHub Pagesで古い画面が出る: ブラウザのPWAキャッシュを削除し、再読み込みしてください。Service Workerのキャッシュ名は更新時に変更しています。

## 旧実装へ戻す場合

旧GASコードは `legacy/gas_code.js` にあります。ただし、旧方式はスプレッドシート行操作や全件上書きにより、同時操作時のデータ消失リスクがあります。戻す前にSupabase側のデータをCSVでバックアップしてください。
