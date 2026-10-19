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

## レビューのしかた

```bash
npm install
npm run preview   # http://localhost:8000 で本を表示
npm test          # GAS のテストと、本と gas/ の一致を確認
```

本のコードを直すときは、`gas/` の同じファイルも同じように直してください。`npm test` が、章ごとのコードを順に積み上げて `gas/` と一致するかを確かめます。
