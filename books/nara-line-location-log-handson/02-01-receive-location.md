---
title: "🧭 位置情報を受け取る"
---

Step1 の Bot は、届いたものをそのまま返すだけでした。この章でおうむ返しを卒業して、**位置情報を受け取って返す Bot** にします。

## 位置情報を送るボタンを作る

テキストが届いたら、「位置情報を送る」ボタン付きで返事をします。`type: "location"` のボタンを押すと、スマホで場所を選ぶ画面が開きます。

`コード.gs` の一番下に足します。

```javascript:コード.gs
function buildLocationQuickReply() {
  return {
    items: [
      {
        type: "action",
        action: { type: "location", label: "位置情報を送る" }
      }
    ]
  };
}
```

## シートを増やす準備をする

Step1 で使っていたシートは `log` だけでした。ここからは `location` や `postback` も使うので、シートの名前と見出しをまとめて持ち、「無ければ作る」関数を用意します。`コード.gs` の先頭に足します。

```javascript:コード.gs
var SHEET_NAMES = {
  LOCATION: "location",
  POSTBACK: "postback",
  LOG: "log"
};

var HEADERS = {
  LOCATION: ["送信日時", "ユーザーID", "メッセージID", "タイトル", "住所", "緯度", "経度"],
  POSTBACK: ["送信日時", "ユーザーID", "メッセージID", "位置情報メッセージID", "データ", "表示テキスト"],
  LOG: ["記録日時", "ユーザーID", "イベント種別", "JSON"]
};

function getOrCreateSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) return sheet;

  var headerKey = sheetName.toUpperCase();
  sheet = ss.insertSheet(sheetName);
  sheet.appendRow(HEADERS[headerKey]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS[headerKey].length)
    .setBackground("#4a86e8")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  return sheet;
}
```

シートは最初に書き込むときに自動でできます。手で作る必要はありません。

`saveLog` も、シートを作る部分を `getOrCreateSheet` に任せて短くします。

```diff:コード.gs
 function saveLog(event) {
-  var ss = SpreadsheetApp.getActiveSpreadsheet();
-  var sheet = ss.getSheetByName("log");
-  if (!sheet) {
-    sheet = ss.insertSheet("log");
-    sheet.appendRow(["記録日時", "ユーザーID", "イベント種別", "JSON"]);
-    sheet.setFrozenRows(1);
-  }
+  var sheet = getOrCreateSheet(SHEET_NAMES.LOG);
   var userId = event.source ? event.source.userId : "";
   sheet.appendRow([new Date(), userId, event.type, JSON.stringify(event)]);
 }
```

## doPost を書き換える

テキストが来たら「位置情報を送ってください」と返し、位置情報が来たらシートに書いて中身を返します。

```diff:コード.gs
 function doPost(e) {
   var body = JSON.parse(e.postData.contents);

   body.events.forEach(function (event) {
     saveLog(event);
-    if (event.type === "message") {
-      var messages = [];
-      if (event.message.type === "text") {
-        messages.push({ type: "text", text: event.message.text });
-      }
-      messages.push({ type: "text", text: JSON.stringify(event.message, null, 2) });
-      reply(event.replyToken, messages);
-    }
+    var userId = event.source ? event.source.userId : "";
+
+    if (event.type === "message" && event.message.type === "text") {
+      replyTextWithQuickReply(event.replyToken, "登録・検索したい場所の位置情報を送ってください", buildLocationQuickReply());
+
+    } else if (event.type === "message" && event.message.type === "location") {
+      var place = toPlace(event.webhookEventId, event.message);
+      saveLocation(userId, place);
+
+      var replyBody =
+        "受け取った位置情報\n" +
+        "タイトル: " + place.title + "\n" +
+        "住所: " + place.address;
+      replyText(event.replyToken, replyBody);
+    }
   });
   // LINE の Webhook 検証で 302 にならないよう、何も返さない
 }
```

`saveLog(event)` は先頭に残したままです。何が届いても、まず `log` シートに1行残ります。

`doPost` から呼んでいる関数を足します。返信は Step1 の `reply` に配列を渡すだけなので、テキスト1通のときの書き方を関数にしておきます。

```javascript:コード.gs
function replyText(replyToken, text) {
  reply(replyToken, [{ type: "text", text: text }]);
}

function replyTextWithQuickReply(replyToken, text, quickReply) {
  reply(replyToken, [{ type: "text", text: text, quickReply: quickReply }]);
}
```

## 届いた位置情報を「場所」にする

位置情報メッセージには、タイトル・住所・緯度・経度が入っています。ただし、**地図で適当な地点を選んで送ると、タイトルが空で届くことがあります**。そのまま返すと「タイトル: undefined」になってしまうので、受け取ったらすぐ、この Bot で使う「場所」の形に直します。

```javascript:コード.gs
function toPlace(messageId, msg) {
  return {
    locationId: messageId,
    title: msg.title || msg.address || "名前のない場所",
    address: msg.address || "",
    latitude: msg.latitude,
    longitude: msg.longitude
  };
}

function saveLocation(userId, place) {
  var sheet = getOrCreateSheet(SHEET_NAMES.LOCATION);
  sheet.appendRow([new Date(), userId, place.locationId, place.title, place.address, place.latitude, place.longitude]);
}
```

タイトルが無ければ住所、それも無ければ「名前のない場所」にします。返信もシートも、この `place` だけを見るので、代わりの名前を決める場所は `toPlace` の1か所で済みます。

:::message
`locationId`（`location` シートの「メッセージID」列）には `event.webhookEventId` を入れています。**この値を、この本では「場所ID」と呼びます。** 次の章からは、ボタンに場所IDを書いて「どの場所のボタンか」を伝えます。
:::

保存したら再デプロイします（「デプロイを管理」→ 新バージョン）。

## ✅ 確認

1. Bot に何かテキストを送る
   → 「位置情報を送ってください」と、「位置情報を送る」ボタンが出る

   ![LINE のトーク画面。「こんにちは！」と送ると、Bot から「登録・検索したい場所の位置情報を送ってください」と返り、下に「位置情報を送る」ボタンが出ている](/images/nara-line-location-log-handson/02-01-01-text-reply.png =380x)

2. ボタンから現在地を送る（検索欄に駅名などを入れて選んでも構いません）

   ![LINE の位置情報の画面。検索欄に「奈良駅」と入れ、地図上の「近鉄奈良駅（近鉄）」にピンが立っている。右上に「送信」がある](/images/nara-line-location-log-handson/02-01-02-send-location.png =380x)

   → タイトルと住所が返ってくる

   ![LINE のトーク画面。送った位置情報の地図のあとに、Bot から「受け取った位置情報 タイトル：近鉄奈良駅（近鉄） 住所：奈良県奈良市東向中町29」と返っている](/images/nara-line-location-log-handson/02-01-03-location-reply.png =380x)

3. スプレッドシートに `location` シートができている

`location` シートに、送った場所が1行入っていれば成功です。

## 🎖️ 早く終わった人へ

### 🎖️ 緯度経度も返信に含める

:::details 答えを見る
```diff:コード.gs
       var replyBody =
         "受け取った位置情報\n" +
         "タイトル: " + place.title + "\n" +
-        "住所: " + place.address;
+        "住所: " + place.address + "\n" +
+        "緯度: " + place.latitude + "\n" +
+        "経度: " + place.longitude;
```
:::
