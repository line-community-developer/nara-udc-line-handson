# まちの記憶アーカイブハンズオン（奈良市 × UDC奈良 × LINE DC）

奈良のまちで見つけた「気になる場所」を LINE で送って記録し、地図で公式データと見比べる **まちの記憶アーカイブBot** を、LINE Messaging API × Google Apps Script で作るハンズオンの教材です。2026-10-31 に BONCHI（奈良）で開催します。

## 中身

| 場所 | 内容 |
| :--- | :--- |
| `books/nara-line-location-log-handson/` | ハンズオンの本（Zenn） |
| `images/nara-line-location-log-handson/` | 本の画像 |
| `gas/` | 完成版の GAS コード（本の最終形と一致） |
| `gas/test/` | GAS をモックで動かすテストと、本の章のコードが `gas/` と一致するかの確認 |
| `data/` | 地図に重ねる公式データのモック |
| `assets/` `scripts/` | リッチメニューの画像と登録スクリプト |
| `docs/gas-line-bot-echo-json.md` | 本の前提になる Qiita 記事（Step1 のおうむ返し Bot）。`chapters.js` が使う |

必要なもの: Node.js（LTS）、Google アカウント、LINE 公式アカウント（Messaging API チャネル）

```bash
npm install
```

## 本を読む・直す

```bash
npm run preview   # http://localhost:8000 で本を表示
npm test          # GAS のテストと、本と gas/ の一致を確認
```

本のコードを直すときは、`gas/` の同じファイルも同じように直します。`npm test` の `chapters.js` が、章ごとのコードを順に積み上げて `gas/` と一字一句一致するかを確かめます。

本は `published: false` です。Zenn の GitHub 連携をしても、公開はされません。

## 完成版の Bot を動かす

ハンズオンでは GAS エディタに手で貼っていきますが、ここでは完成版の `gas/` を clasp でまとめて送ります。

### 1. GAS プロジェクトを作って送る

```bash
npx clasp login
npx clasp create --type sheets --title "まちの記憶アーカイブBot" --rootDir gas
npx clasp push
```

`create` で、スプレッドシートと、それに紐づく GAS プロジェクトができます。設定はリポジトリ直下の `.clasp.json` に入ります（git には入りません）。`gas/test/` は `.claspignore` で除外しているので送られません。

### 2. スクリプトプロパティを入れる

```bash
npx clasp open-script
```

エディタの「プロジェクトの設定」→「スクリプト プロパティ」に入れます。

| プロパティ | 値 | 使うところ |
| :--- | :--- | :--- |
| `LINE_ACCESS_TOKEN` | チャネルアクセストークン（長期） | 返信・写真の取得・リッチメニュー（必須） |
| `LINE_BASIC_ID` | ベーシックID（`@` から始まる） | 「QR発行 ○○」 |
| `DRIVE_FOLDER_ID` | 手で入れなくてよい | 下の `setupPhotoFolder` が入れる |

### 3. セットアップ関数を実行する

エディタの関数プルダウンで選んで、順に実行します。初回は Google の権限確認が出るので、許可します。

| 関数 | やること |
| :--- | :--- |
| `setupSheets` | `question`（質問）・`answer`・`submission`（集計）のシートを用意する |
| `setupPhotoFolder` | 写真を保存する Drive フォルダを作り、`DRIVE_FOLDER_ID` に入れる |

### 4. デプロイして Webhook に設定する

```bash
npx clasp deploy
```

ウェブアプリの URL は、表示されたデプロイ ID（`AKfy...`）を使って `https://script.google.com/macros/s/<デプロイID>/exec` です。この URL を LINE Developers の「Messaging API設定」→「Webhook URL」に入れ、「Webhookの利用」をオンにします。LINE Official Account Manager で、応答メッセージはオフにしておきます。

コードを直したあとは、**同じデプロイ ID を更新**します。新しくデプロイすると URL が変わり、Webhook とリッチメニューの URL を入れ直すことになります。

```bash
npx clasp push && npx clasp deploy -i <デプロイID>
```

### 5. リッチメニューを登録する

```bash
LINE_ACCESS_TOKEN=xxxx MAP_URL="https://script.google.com/macros/s/<デプロイID>/exec?view=map" \
  node scripts/register-richmenu.mjs --replace
```

**`MAP_URL` は必ず自分のデプロイの URL にします。** 省略すると、「地図を見る」ボタンが主催者の地図を開きます。送る内容だけ見たいときは `--dry-run` を付けます（トークン不要）。

GAS エディタから `setupRichMenu` を実行しても登録できます。こちらは地図の URL を自動で入れ、画像は GitHub に置いたものを使います。

### 6. 動作確認

| LINE での操作 | 返ってくるもの |
| :--- | :--- |
| 位置情報を送る →「この場所を登録する」 | 写真 → 質問に答えると、「登録しました！」のカード |
| 位置情報を送る →「近くを検索する」 | 登録した場所を近い順に並べたカード |
| リッチメニュー「地図を見る」 | 地図が開く。灰色が公式データ、色つきが登録した場所、数字の丸は近い場所のまとまり |
| `マップ` と送る | 地図の URL |
| リッチメニュー「地図を共有」 | 地図の URL と QR コード |
| `QR発行 東大寺` と送る | Bot とのトークを開く QR コード |
| `一覧` と送る | 登録した場所（新しい順に5件）と削除ボタン |

うまく動かないときは、本の `99-faq.md` を見てください。
