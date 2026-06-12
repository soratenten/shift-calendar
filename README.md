# シフトカレンダー

シフト文字列を貼り付けるだけで勤務カレンダーを管理できるPWAアプリです。

## セットアップ手順

### 1. リポジトリを作成

GitHub で新規リポジトリを作成（例: `shift-calendar`）

### 2. vite.config.js を編集

`REPO_NAME` をあなたのリポジトリ名に合わせて変更：

```js
const REPO_NAME = "/shift-calendar/";  // ← リポジトリ名に変更
```

### 3. ファイルをプッシュ

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/shift-calendar.git
git push -u origin main
```

### 4. GitHub Pages を有効化

- リポジトリの **Settings → Pages**
- Source: **GitHub Actions** を選択
- 保存すると自動でビルド＆デプロイされます

### 5. アクセス

```
https://あなたのユーザー名.github.io/shift-calendar/
```

## ローカル開発

```bash
npm install
npm run dev
```

## 機能

- シフト文字列の読み込みとカレンダー表示
- 月別勤務時間・休憩時間の集計
- シフトチェンジ申請内容の計算
- Apple/Google カレンダーへの .ics 書き出し
- ブラウザのlocalStorageにデータ保存
- PWA対応（ホーム画面に追加可能）