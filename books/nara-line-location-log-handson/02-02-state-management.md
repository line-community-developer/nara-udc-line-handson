---
title: "🧭 会話の「状態」を管理する"
---

前の章の Bot は、1回聞かれて1回返したら終わりでした。ここからは**何往復かする会話**を作ります。

- 位置情報を送る →「登録する？検索する？」と聞かれる → 選ぶ
- 登録を選ぶ →「何がある？」→ 選ぶ →「どのくらい古そう？」→ 選ぶ → 登録完了

LINE からは、メッセージやボタンが1つずつバラバラに届きます。「石仏・お地蔵さん」のボタンが押されたとき、Bot はそれが**どの場所の・何問目への答えか**を覚えていないと続きを返せません。これが状態管理です。この章では、その覚え方を作ります。

## 1人1行のメモ

覚え方はシンプルです。**ユーザー1人につき `state` シートの1行に、「いま何を待っているか」をメモしておきます。** 会話が進むたびに、同じ行を上書きします。

| 列 | 中身 |
| :--- | :--- |
| `user_id` | LINE のユーザーID |
| `status` | いま何を待っているか（下の表） |
| `payload` | 場所（場所ID・タイトル・住所・緯度経度）と、何問目を待っているか・ここまでの回答（JSON 文字列） |
| `updated_at` | 最後に書き換えた日時。30分たったら期限切れ扱い |

`status` は、この本の会話では3つだけです。

| status | 意味 | 次に来るもの |
| :--- | :--- | :--- |
| `pending_choice` | 位置情報を受け取った | 「登録する」か「検索する」のボタン |
| `answering` | 質問の答えを待っている | 選択肢のボタン |
| `done` | 会話が終わった | 次の位置情報 |

ボタンが押されたら、押した人の `userId` で自分の行を引きます。行を見れば「この人は問1の答えを待っていた」と分かります。スプレッドシートなので、会話がいまどこまで進んだかを目で見られます。

## State.gs を作る

左メニューの「ファイル」の **＋** →「スクリプト」を選び、名前を **`State`** にします。GAS はファイルが分かれていても全部まとめて1つのプログラムとして動くので、`import` は要りません。

`State.gs` に貼り付けます。

```javascript:State.gs
var STATE_EXPIRES_MINUTES = 30;

function setState(userId, status, payload) {
  var sheet = getOrCreateSheet(SHEET_NAMES.STATE);
  var row = [userId, status, JSON.stringify(payload || {}), new Date()];
  var match = sheet.getRange("A:A").createTextFinder(userId).matchEntireCell(true).findNext();

  if (match) {
    sheet.getRange(match.getRow(), 1, 1, 4).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function getState(userId) {
  var sheet = getOrCreateSheet(SHEET_NAMES.STATE);
  var match = sheet.getRange("A:A").createTextFinder(userId).matchEntireCell(true).findNext();
  if (!match) return null;

  var values = sheet.getRange(match.getRow(), 1, 1, 4).getValues()[0];
  var status = values[1];
  var updatedAt = values[3];
  if (status === "done") return null;
  if (updatedAt instanceof Date && Date.now() - updatedAt.getTime() > STATE_EXPIRES_MINUTES * 60 * 1000) return null;

  return { status: status, payload: JSON.parse(values[2] || "{}") };
}

function clearState(userId) {
  setState(userId, "done", {});
}
```

`setState` は「1列目（`A:A`）に自分の `userId` があればその行を上書き、無ければ1行足す」だけです。何回会話しても、1人の行は1行のままです。

`getState` は、行が無い・`done`・最後の更新から30分たった、のどれかなら `null` を返します。位置情報を送ったまま休憩して、30分後にボタンを押す人は必ず出ます。`null` のときに「もう一度位置情報を送ってください」と返すのは次の章で書きます。

## state シートを登録する

`コード.gs` の先頭の `SHEET_NAMES` と `HEADERS` に `STATE` を足します。

```diff:コード.gs
 var SHEET_NAMES = {
   LOCATION: "location",
   POSTBACK: "postback",
-  LOG: "log"
+  LOG: "log",
+  STATE: "state"
 };

 var HEADERS = {
   LOCATION: ["送信日時", "ユーザーID", "メッセージID", "タイトル", "住所", "緯度", "経度"],
   POSTBACK: ["送信日時", "ユーザーID", "メッセージID", "位置情報メッセージID", "データ", "表示テキスト"],
-  LOG: ["記録日時", "ユーザーID", "イベント種別", "JSON"]
+  LOG: ["記録日時", "ユーザーID", "イベント種別", "JSON"],
+  STATE: ["user_id", "status", "payload", "updated_at"]
 };
```

## ✅ 確認

この章だけでは、LINE の見た目は変わりません。保存してエラーが出なければ大丈夫です。実際に state を使うのは次の章です。

## 🎖️ 早く終わった人へ

### 🎖️ state シートに1行作ってみる

LINE を通さずに、エディタから `setState` を動かしてみます。

:::details 試し方
`State.gs` の一番下に、テスト用の関数を一時的に足します。

```javascript:State.gs
function testSetState() {
  setState("test-user-001", "pending_choice", { title: "近鉄奈良駅", latitude: 34.6844, longitude: 135.8279 });
  setState("test-user-001", "answering", { title: "近鉄奈良駅", question: 1 });
  console.log(JSON.stringify(getState("test-user-001"), null, 2));
}
```

エディタ上部の関数プルダウンで **`testSetState`** を選んで「実行」します。`state` シートができて、`setState` を2回呼んだのに**行は1行だけ**、`status` が `answering` になっていれば成功です。試したら、この関数とシートの行は消しておきましょう。
:::
