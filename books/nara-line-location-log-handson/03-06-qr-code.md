---
title: "🎖️ QRコードを作る"
---

QR コードを、Bot に作ってもらいます。作るのは2種類です。

- 場所に貼っておく、**Bot とのトーク画面が開く** QR コード
- 隣の人に見せて開いてもらう、**地図の URL** の QR コード

この章で作るのは **QR コードを作る側**だけです。カメラで読み取る機能は作りません。

## 読むとトーク画面が開く QR コード

LINE には、**「友だちのトーク画面を、文字を入れた状態で開く」URL** があります。

```
https://line.me/R/oaMessage/@<ベーシックID>/?<入れておく文字>
```

この URL を QR コードにして、石碑のそばや、まちの案内板に貼っておきます。読み取った人の LINE で Bot とのトーク画面が開き、「訪問: 東大寺」のような文字が入った状態になります。あとは送信を押すだけです。

## ベーシックID を登録する

LINE Developers の「Messaging API設定」タブにある **ボットのベーシックID**（`@` から始まる文字列）を、スクリプトプロパティに足します。Step1 でトークンを登録したのと同じ場所です（左メニュー「プロジェクトの設定」（歯車）→「スクリプト プロパティ」→「スクリプト プロパティを追加」）。スクリプトプロパティを足しただけなら、再デプロイは要りません。

| プロパティ | 値 |
| :--- | :--- |
| `LINE_BASIC_ID` | ベーシックID（例: `@123abcde`） |

## コードを書く

新しいファイル `QrCode.gs` を作ります。

```javascript:QrCode.gs
function buildOaMessageUri(basicId, presetText) {
  if (!basicId || basicId.charAt(0) !== "@") {
    throw new Error("basicId は @ から始まるベーシックIDを渡してください: " + basicId);
  }
  var idWithoutAt = basicId.slice(1);
  return "https://line.me/R/oaMessage/@" + idWithoutAt + "/?" + encodeURIComponent(presetText);
}

function buildQrImageUrl(data, size) {
  var px = size || 300;
  return "https://api.qrserver.com/v1/create-qr-code/?size=" + px + "x" + px + "&data=" + encodeURIComponent(data);
}

function buildQrImageMessage(basicId, placeName) {
  var uri = buildOaMessageUri(basicId, "訪問: " + placeName);
  var qrImageUrl = buildQrImageUrl(uri);
  return {
    type: "image",
    originalContentUrl: qrImageUrl,
    previewImageUrl: qrImageUrl
  };
}

function replyQrCode(replyToken, placeName) {
  var basicId = PropertiesService.getScriptProperties().getProperty("LINE_BASIC_ID");
  if (!basicId) throw new Error("スクリプトプロパティに LINE_BASIC_ID を設定してください（例: @123abcde）");

  reply(replyToken, [buildQrImageMessage(basicId, placeName)]);
}
```

QR コードの画像は自分で作りません。`api.qrserver.com` という QR コード生成サービスの URL を組み立てているだけです。

画像メッセージは、画像の URL を渡すと LINE が自分で取りに行ってくれます。なので、その URL をそのまま `originalContentUrl`（元画像）と `previewImageUrl`（トークに出る小さい画像）に入れています。GAS で画像をダウンロードしたり、保存したりする必要はありません。

## 地図の QR コードを作る

もう1つ、地図の URL を QR コードにして返す関数を足します。`QrCode.gs` に続けて貼り付けます。

```javascript:QrCode.gs
function replyMapQrCode(replyToken) {
  var mapUrl = ScriptApp.getService().getUrl() + "?view=map";
  var qrImageUrl = buildQrImageUrl(mapUrl);
  reply(replyToken, [
    { type: "text", text: "この QR コードから地図を開けます\n" + mapUrl },
    { type: "image", originalContentUrl: qrImageUrl, previewImageUrl: qrImageUrl }
  ]);
}
```

URL をそのまま QR コードにしているだけなので、読み取った人はブラウザで地図が開きます。1回の返信に、URL のテキストと QR コードの画像を2つ並べています（`reply` は最大5つまで並べられます）。

`handleTextMessage` に、「地図を共有」と送られたときの分岐を足します。リッチメニューの「地図を共有」ボタンが送るのも、このテキストです（[リッチメニューを作る](./03-03-rich-menu)）。

```diff:コード.gs
+  if (text === "地図を共有") {
+    replyMapQrCode(replyToken);
+    return;
+  }
+
   replyTextWithQuickReply(replyToken, "登録・検索したい場所の位置情報を送ってください", buildLocationQuickReply());
 }
```

## doPost に組み込む

「QR発行 東大寺」のように送ると、その場所名を入れた QR コードが返ってくるようにします。

```diff:コード.gs
       if (msg.type === "text") {
+        if (msg.text.indexOf("QR発行 ") === 0) {
+          var placeName = msg.text.replace("QR発行 ", "");
+          replyQrCode(event.replyToken, placeName);
+          return;
+        }
+
         handleTextMessage(event.replyToken, userId, msg.text);

       } else if (msg.type === "location") {
```

`forEach` の中の `return` は、このイベントの処理をここで終わりにする、という意味です。

再デプロイして試します。

## ✅ 確認

1. Bot に「QR発行 東大寺」と送る
   → QR コードの画像が返ってくる

   ![LINE のトーク画面。「QR発行 東大寺」と送ると、Bot から QR コードの画像が返ってきている](/images/nara-line-location-log-handson/03-06-01-qr-place.jpg =380x)
2. 別のスマホか、PC の画面に出した QR コードを LINE で読み取る
   → Bot とのトーク画面が開き、「訪問: 東大寺」が入っている
3. そのまま送信する
   → いつものテキストと同じく、「位置情報を送ってください」が返ってくる

3 まで進んで、QR コードから Bot の会話に入れたら成功です。

続けて、地図の QR コードも試します。

4. Bot に「地図を共有」と送る（リッチメニューを作っていれば、「地図を共有」ボタンを押す）
   → 地図の URL と、その QR コードの画像が返ってくる

   ![LINE のトーク画面。「地図を共有」と送ると、Bot から「この QR コードから地図を開けます」と地図の URL、その下に QR コードの画像が返ってきている](/images/nara-line-location-log-handson/03-06-02-qr-map.jpg =380x)
5. 別のスマホか、PC の画面に出した QR コードを読み取る
   → ブラウザで地図が開く（[マップへ表示する](./03-04-map-display) をまだ作っていなければ「スクリプト関数が見つかりません: doGet」と出ます。正常です）

## 🎖️ 早く終わった人へ
