---
title: "🧭 GPS検索を作る"
---

最後に「近くを検索する」を作って、Step2 を完成させます。地図の API は使いません。**`submission` に並んだ場所（全問答えて登録した場所）**の中から、近い順に探します。

## 2点間の距離を計算する

緯度経度から距離を出すには、Haversine（ハバーサイン）の公式を使います。地球を球とみなして、2点間の直線距離を求める定番の式です。

新しいファイル `Search.gs` を作ります（作り方は `State.gs` と同じです）。

```javascript:Search.gs
var EARTH_RADIUS_KM = 6371;

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  var toRad = function (deg) { return (deg * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
```

:::message
近鉄奈良駅（34.6844, 135.8279）と東大寺（34.6889, 135.8398）で計算すると、約1.2km です。道のりではなく直線距離なので、歩くともう少し長くなります。
:::

## submission から近い順に探す

`Search.gs` に続けて貼り付けます。

```javascript:Search.gs
function readSubmission() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.SUBMISSION);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return values
    .filter(function (row) { return typeof row[3] === "number"; })
    .map(function (row) {
      return { locationId: row[0], title: row[1], address: row[2], latitude: row[3], longitude: row[4] };
    });
}

function searchNearbyLocations(lat, lng, limit) {
  limit = limit || 5;
  var results = readSubmission().map(function (loc) {
    loc.distanceKm = haversineDistanceKm(lat, lng, loc.latitude, loc.longitude);
    return loc;
  });

  results.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
  return results.slice(0, limit);
}

function formatSearchResults(results) {
  if (results.length === 0) {
    return "登録された場所がまだありません。まずは場所を1件登録してみてください。";
  }
  var lines = results.map(function (r, i) {
    return (i + 1) + ". " + r.title + "（" + r.distanceKm.toFixed(2) + "km）\n" + r.address;
  });
  return "近い順に見つかった場所です\n\n" + lines.join("\n\n");
}
```

`readSubmission` は `submission` シートの左5列（場所のID・タイトル・住所・緯度・経度）を読みます。緯度が数値の行だけを残すので、「（全問に答えた場所はまだありません）」の行は入りません。`submission` がまだ無いとき（`setupSheets` を実行していない）は空です。

`searchNearbyLocations` は、読んだ場所すべての距離を計算してから並べ替えているだけです。ハンズオンの規模（数十〜数百件）なら、これで十分速く動きます。

いま送った場所は、まだ質問に答えていないので `submission` に並んでいません。なので、**自分自身が 0.00km で1位に出てくることはありません。**

## 「検索する」を押したときの処理

`handlePostback` に、`action` が `search` の分岐を足します。

```diff:コード.gs
     askQuestion(replyToken, place.locationId, 1);
     return;
   }

+  if (data.action === "search") {
+    var results = searchNearbyLocations(state.payload.latitude, state.payload.longitude, 5);
+    replyText(replyToken, formatSearchResults(results));
+    clearState(userId);
+    return;
+  }
+
   if (data.action === "answer") {
     var questions = getQuestions();
```

緯度経度は、位置情報を受け取ったときに state の `payload` に入れておいたものです。位置情報を送ったその場で検索まで終わるので、場所を聞き直さずに済みます。

再デプロイして試します。

## ✅ 確認

1. 位置情報を送り、「近くを検索する」を押す
   → 登録した場所が、近い順に距離付きで返ってくる
2. 一覧に、いま送った場所自身が入っていないことを確かめる
3. `submission` シートを見る
   → 検索に使った場所は増えていない

`submission` にまだ1件も無いと、「登録された場所がまだありません」と返ってきます。故障ではありません。場所をいくつか登録してから試してください。

`state` シートで自分の行が `done` になっていれば成功です。これで **Step2 は完成**です。

## 🎖️ 早く終わった人へ

### 🎖️ 表示件数を変える

:::details 答えを見る
```diff:コード.gs
-    var results = searchNearbyLocations(state.payload.latitude, state.payload.longitude, 5);
+    var results = searchNearbyLocations(state.payload.latitude, state.payload.longitude, 10);
```
:::

### 🎖️ 遠すぎる場所を外す

:::details 答えを見る
並べ替えたあとに、距離で絞り込みます。

```diff:Search.gs
   results.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
-  return results.slice(0, limit);
+  return results.filter(function (r) { return r.distanceKm <= 5; }).slice(0, limit);
```

5km より遠い場所を外す例です。数字を変えれば範囲を変えられます。
:::
