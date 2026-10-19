---
title: "📗 全部盛りのGASコード"
---

Step3 のもくもく機能を**全部**入れたときの GAS プロジェクトです。自分のコードと見比べたり、動かなくなったときの答え合わせに使ってください。

:::message
全部貼る必要はありません。**自分が作った章のぶんだけで動きます。**
:::

## スクリプトプロパティ一覧

作った機能によって、要るものが変わります。

| プロパティ | 使う章 |
| :--- | :--- |
| `LINE_ACCESS_TOKEN` | [Step1 の Qiita 記事](https://qiita.com/4geru/items/5e5e23d6540beed4adc0)（必須） |
| `DRIVE_FOLDER_ID` | [写真をアップロードする](./03-01-photo-upload) |
| `LINE_BASIC_ID` | [QRコードを作る](./03-06-qr-code) |

## ファイル構成

左メニューに次の11ファイルが並んでいれば、全部入りです。

```
コード.gs            … Webhook の入口・LINE への返信・シートの読み書き
State.gs             … 会話の状態管理（ユーザー1人1行）
Question.gs          … 質問シートの読み込み・質問の出し方・setupSheets と数式
Search.gs            … submission の読み込みと GPS 検索（Haversine の公式）
写真アップロード.gs
FlexMessage.gs
リッチメニュー.gs
OfficialData.gs     … 地図に重ねる公式データ
マップ表示.gs        … doGet もここにある
QrCode.gs
一覧削除.gs
```

`appsscript.json` は、エディタの「プロジェクトの設定」で「「appsscript.json」マニフェスト ファイルをエディタで表示する」をオンにすると見えます。ふだんは触らなくて大丈夫です。

## コード.gs

:::details コード全体を見る
```javascript:コード.gs
/**
 * LINE位置ログBot
 * 位置情報は location、ボタンは postback にそのまま残す。
 * 「いま何問目を待っているか」は state にユーザー1人1行で覚える。
 * 質問（question）に全部答えた場所が、数式で submission に並ぶ。
 */

// =============================================
// スプレッドシート設定
// =============================================

var SHEET_NAMES = {
  LOCATION: "location",
  POSTBACK: "postback",
  LOG: "log",
  STATE: "state",
  QUESTION: "question",
  ANSWER: "answer",
  SUBMISSION: "submission",
  PHOTO: "photo"
};

var HEADERS = {
  LOCATION: ["送信日時", "ユーザーID", "メッセージID", "タイトル", "住所", "緯度", "経度", "写真URL"],
  POSTBACK: ["送信日時", "ユーザーID", "メッセージID", "位置情報メッセージID", "データ", "表示テキスト"],
  LOG: ["記録日時", "ユーザーID", "イベント種別", "JSON"],
  STATE: ["user_id", "status", "payload", "updated_at"],
  PHOTO: ["送信日時", "ユーザーID", "メッセージID", "ファイル名", "ファイルID", "URL"]
};

// =============================================
// Webhook エントリポイント
// =============================================

/**
 * LINEからのリクエストを受け取り処理する。
 *
 * @param {Object} e - GASのdoPostイベントオブジェクト
 */
function doPost(e) {
  var body = JSON.parse(e.postData.contents);

  body.events.forEach(function (event) {
    saveLog(event);
    var userId = event.source ? event.source.userId : "";

    if (event.type === "message") {
      var msg = event.message;

      if (msg.type === "text") {
        if (msg.text.indexOf("QR発行 ") === 0) {
          var placeName = msg.text.replace("QR発行 ", "");
          replyQrCode(event.replyToken, placeName);
          return;
        }

        handleTextMessage(event.replyToken, userId, msg.text);

      } else if (msg.type === "location") {
        var place = toPlace(event.webhookEventId, msg);
        saveLocation(userId, place);
        handleLocationMessage(event.replyToken, userId, place);

      } else if (msg.type === "image") {
        handleImageMessage(event.replyToken, userId, msg);
      }

    } else if (event.type === "postback") {
      var data = JSON.parse(event.postback.data);
      var displayText = event.postback.displayText || "";
      handlePostback(event.replyToken, userId, event.webhookEventId, data, displayText);
    }
  });
  // LINE の Webhook 検証で 302 にならないよう、何も返さない
}

/**
 * 位置情報メッセージを、この Bot で使う「場所」の形にする。
 * タイトルが無いときは住所、それも無ければ「名前のない場所」にする。
 */
function toPlace(messageId, msg) {
  return {
    locationId: messageId,
    title: msg.title || msg.address || "名前のない場所",
    address: msg.address || "",
    latitude: msg.latitude,
    longitude: msg.longitude
  };
}

// =============================================
// フロー制御
// =============================================

function handleTextMessage(replyToken, userId, text) {
  if (text === "マップ") {
    replyText(replyToken, "マップを開く: " + ScriptApp.getService().getUrl() + "?view=map");
    return;
  }

  if (text === "地図を共有") {
    replyMapQrCode(replyToken);
    return;
  }

  if (text === "一覧") {
    replyLocationList(replyToken);
    return;
  }

  replyTextWithQuickReply(replyToken, "登録・検索したい場所の位置情報を送ってください", buildLocationQuickReply());
}

function handleLocationMessage(replyToken, userId, place) {
  setState(userId, "pending_choice", place);

  var replyBody =
    "受け取った位置情報\n" +
    "タイトル: " + place.title + "\n" +
    "住所: " + place.address;
  replyTextWithQuickReply(replyToken, replyBody, buildChoiceQuickReply(place.locationId));
}

function handlePostback(replyToken, userId, messageId, data, displayText) {
  if (data.action === "delete") {
    if (handleDeletePostback(replyToken, data.locationId)) {
      savePostback(userId, messageId, data.locationId, JSON.stringify(data), displayText);
    }
    return;
  }

  var state = getState(userId);
  if (!isCurrentButton(state, data)) {
    replyText(replyToken, "もう一度位置情報を送ってください。");
    return;
  }

  // 受け付けたボタンだけを postback に残す（断ったボタンは log にだけ残る）
  savePostback(userId, messageId, data.locationId, JSON.stringify(data), displayText);

  if (data.action === "register") {
    var place = state.payload;
    place.question = 1;
    place.answers = {};
    setState(userId, "waiting_photo", place);
    askPhoto(replyToken, place.locationId);
    return;
  }

  if (data.action === "skip_photo") {
    setState(userId, "answering", state.payload);
    askQuestion(replyToken, state.payload.locationId, 1);
    return;
  }

  if (data.action === "search") {
    var results = searchNearbyLocations(state.payload.latitude, state.payload.longitude, 5);
    if (results.length === 0) {
      replyText(replyToken, "登録された場所がまだありません。まずは場所を1件登録してみてください。");
    } else {
      replyFlex(replyToken, buildLocationFlexCarousel(results));
    }
    clearState(userId);
    return;
  }

  if (data.action === "answer") {
    var questions = getQuestions();
    var answering = state.payload;
    var question = questions[data.question - 1];
    answering.answers[data.question] = question ? question.choices[data.choice - 1] : "";

    if (data.question < questions.length) {
      answering.question = data.question + 1;
      setState(userId, "answering", answering);
      askQuestion(replyToken, answering.locationId, answering.question);
      return;
    }

    clearState(userId);
    replyFlex(replyToken, buildCompletionCard(answering, questions));
    return;
  }

  replyText(replyToken, "受け取ったpostbackデータ\n" + JSON.stringify(data, null, 2));
}

/**
 * 押されたボタンが、いま進んでいる会話のものかを確かめる。
 * 場所が違う・回答待ちの問番号が違う（二度押し・古いボタン）・期限切れなら false。
 */
function isCurrentButton(state, data) {
  if (!state || state.payload.locationId !== data.locationId) return false;
  if (data.action === "answer") {
    return state.status === "answering" && state.payload.question === data.question;
  }
  if (data.action === "skip_photo") {
    return state.status === "waiting_photo";
  }
  return state.status === "pending_choice";
}

// =============================================
// Quick Reply / メッセージ組み立て
// =============================================

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

function buildChoiceQuickReply(locationId) {
  var choices = [
    { label: "この場所を登録する", action: "register" },
    { label: "近くを検索する", action: "search" }
  ];
  return {
    items: choices.map(function (choice) {
      return {
        type: "action",
        action: {
          type: "postback",
          label: choice.label,
          data: JSON.stringify({ action: choice.action, locationId: locationId }),
          displayText: choice.label
        }
      };
    })
  };
}

// =============================================
// LINE API
// =============================================

function reply(replyToken, messages) {
  callLineApi("https://api.line.me/v2/bot/message/reply", {
    replyToken: replyToken,
    messages: messages
  });
}

function replyText(replyToken, text) {
  reply(replyToken, [{ type: "text", text: text }]);
}

function replyTextWithQuickReply(replyToken, text, quickReply) {
  reply(replyToken, [{ type: "text", text: text, quickReply: quickReply }]);
}

function callLineApi(url, payload) {
  var token = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload)
  });
}

// =============================================
// スプレッドシート操作
// =============================================

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

function saveLocation(userId, place) {
  var sheet = getOrCreateSheet(SHEET_NAMES.LOCATION);
  sheet.appendRow([new Date(), userId, place.locationId, place.title, place.address, place.latitude, place.longitude]);
}

function savePostback(userId, messageId, locationId, data, displayText) {
  var sheet = getOrCreateSheet(SHEET_NAMES.POSTBACK);
  sheet.appendRow([new Date(), userId, messageId, locationId, data, displayText || ""]);
}

function saveLog(event) {
  var sheet = getOrCreateSheet(SHEET_NAMES.LOG);
  var userId = event.source ? event.source.userId : "";
  sheet.appendRow([new Date(), userId, event.type, JSON.stringify(event)]);
}
```
:::

## State.gs

:::details コード全体を見る
```javascript:State.gs
/**
 * 会話の状態管理
 * ユーザー1人につき state シートの1行に「いま何を待っているか」を書いておく。
 */

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
:::

## Question.gs

:::details コード全体を見る
```javascript:Question.gs
/**
 * 質問マスタ（question シート）
 * 1行が1問。A列が質問文、B〜F列が選択肢1〜5（空欄は使わない）。
 * setupSheets をエディタから1回実行すると、question・answer・submission ができる。
 */

var QUESTION_HEADERS = ["質問", "選択肢1", "選択肢2", "選択肢3", "選択肢4", "選択肢5"];

var SAMPLE_QUESTIONS = [
  ["カテゴリは？", "カフェ", "レストラン", "観光地", "公園", "その他"],
  ["また行きたい？", "ぜひ", "たぶん", "もういいかな", "", ""]
];

function getQuestions() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.QUESTION);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var questions = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === "") break;
    questions.push({
      text: String(values[i][0]),
      choices: values[i].slice(1).map(function (v) { return String(v); })
    });
  }
  return questions;
}

function askQuestion(replyToken, locationId, n, prefix) {
  var question = getQuestions()[n - 1];
  if (!question) {
    replyText(replyToken, "質問が見つかりません。question シートを確かめてください（setupSheets を実行）。");
    return;
  }

  var items = [];
  question.choices.forEach(function (choice, i) {
    if (choice === "") return;
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: choice.slice(0, 20),
        data: JSON.stringify({ action: "answer", locationId: locationId, question: n, choice: i + 1 }),
        displayText: choice
      }
    });
  });
  replyTextWithQuickReply(replyToken, (prefix ? prefix + "\n" : "") + "問" + n + ". " + question.text, { items: items });
}

function setupSheets() {
  getOrCreateSheet(SHEET_NAMES.LOCATION);
  getOrCreateSheet(SHEET_NAMES.POSTBACK);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_NAMES.QUESTION)) {
    var question = ss.insertSheet(SHEET_NAMES.QUESTION);
    question.appendRow(QUESTION_HEADERS);
    SAMPLE_QUESTIONS.forEach(function (row) { question.appendRow(row); });
    question.setFrozenRows(1);
  }

  var answer = ss.getSheetByName(SHEET_NAMES.ANSWER) || ss.insertSheet(SHEET_NAMES.ANSWER);
  answer.getRange("A1").setFormula(ANSWER_FORMULA);
  answer.getRange("H1").setFormula(ANSWER_ERROR_FORMULA);

  var submission = ss.getSheetByName(SHEET_NAMES.SUBMISSION) || ss.insertSheet(SHEET_NAMES.SUBMISSION);
  submission.getRange("A1").setFormula(SUBMISSION_FORMULA);

  console.log("question / answer / submission を準備しました");
}

// ---- 数式（answer と submission はこの数式だけでできる） ----

var ANSWER_FORMULA = '=ARRAYFORMULA(LET(d,FILTER(postback!A2:F,postback!A2:A<>""),n,SEQUENCE(ROWS(d)),js,CHOOSECOLS(d,5),act,IFERROR(REGEXEXTRACT(js,"""action""\\s*:\\s*""([^""]*)"""),""),loc,IFERROR(REGEXEXTRACT(js,"""locationId""\\s*:\\s*""([^""]*)"""),""),q,IFERROR(VALUE(REGEXEXTRACT(js,"""question""\\s*:\\s*(\\d+)")),0),c,IFERROR(VALUE(REGEXEXTRACT(js,"""choice""\\s*:\\s*(\\d+)")),0),txt,MAP(q,c,LAMBDA(x,y,IF(OR(x<1,y<1),"",IFERROR(INDEX(question!B2:F,x,y)&"","")))),ok,(act="answer")*(loc<>"")*(txt<>""),VSTACK({"送信日時","行番号","場所ID","問番号","選択番号","選んだ文字"},IFERROR(SORT(FILTER(HSTACK(CHOOSECOLS(d,1),n,loc,q,c,txt),ok=1),1,TRUE,2,TRUE),{"","","","","",""}))))';

var ANSWER_ERROR_FORMULA = '=ARRAYFORMULA(LET(d,FILTER(postback!A2:F,postback!A2:A<>""),js,CHOOSECOLS(d,5),act,IFERROR(REGEXEXTRACT(js,"""action""\\s*:\\s*""([^""]*)"""),""),loc,IFERROR(REGEXEXTRACT(js,"""locationId""\\s*:\\s*""([^""]*)"""),""),q,IFERROR(VALUE(REGEXEXTRACT(js,"""question""\\s*:\\s*(\\d+)")),0),c,IFERROR(VALUE(REGEXEXTRACT(js,"""choice""\\s*:\\s*(\\d+)")),0),txt,MAP(q,c,LAMBDA(x,y,IF(OR(x<1,y<1),"",IFERROR(INDEX(question!B2:F,x,y)&"","")))),VSTACK("読めなかった行（メッセージID）",IFERROR(FILTER(CHOOSECOLS(d,3),(act="answer")*(((loc="")+(txt=""))>0)),"なし"))))';

var SUBMISSION_FORMULA = '=ARRAYFORMULA(LET(qs,FILTER(question!A2:A,question!A2:A<>""),nq,ROWS(qs),aloc,FILTER(answer!C2:C,answer!C2:C<>""),aq,FILTER(answer!D2:D,answer!C2:C<>""),at,FILTER(answer!F2:F,answer!C2:C<>""),akey,aloc&"|"&aq,lr,FILTER(location!C2:G,location!C2:C<>"",ISNUMBER(MATCH(location!C2:C,aloc,0))),ids,CHOOSECOLS(lr,1),ans,MAKEARRAY(ROWS(ids),nq,LAMBDA(r,k,XLOOKUP(INDEX(ids,r)&"|"&k,akey,at,"無回答",0,-1))),full,HSTACK(lr,ans),done,BYROW(ans,LAMBDA(row,SUM(--(row="無回答"))=0)),IFNA(VSTACK(HSTACK({"場所のID","タイトル","住所","緯度","経度"},TRANSPOSE(qs)),IFERROR(FILTER(full,done),"（全問に答えた場所はまだありません）")),"")))';
```
:::

## Search.gs

:::details コード全体を見る
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

/**
 * submission（全問に答えた場所）を読む。緯度が数値の行だけを返す。
 * submission がまだ無いとき（setupSheets を実行していない）は空。
 */
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
:::

## 写真アップロード.gs

:::details コード全体を見る
```javascript:写真アップロード.gs
function setupPhotoFolder() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("DRIVE_FOLDER_ID")) {
    console.log("すでに設定済みです: " + props.getProperty("DRIVE_FOLDER_ID"));
    return;
  }

  var folder = DriveApp.createFolder("位置ログBot 写真");
  props.setProperty("DRIVE_FOLDER_ID", folder.getId());
  console.log("フォルダを作成しました: " + folder.getUrl());
}

function handleImageMessage(replyToken, userId, msg) {
  try {
    if (msg.contentProvider && msg.contentProvider.type !== "line") {
      replyText(replyToken, "この写真は保存に対応していない形式でした。");
      return;
    }

    var blob = fetchLineImageContent(msg.id);
    var file = savePhotoToDrive(blob, msg.id);
    savePhoto(userId, msg.id, file.getName(), file.getId(), file.getUrl());

    var state = getState(userId);
    if (state && state.status === "waiting_photo") {
      var place = state.payload;
      place.photoUrl = buildThumbnailUrl(file.getId());
      setLocationPhoto(place.locationId, place.photoUrl);
      setState(userId, "answering", place);
      askQuestion(replyToken, place.locationId, 1, "写真を保存しました！");
      return;
    }

    replyText(replyToken, "写真を保存しました！\n" + file.getUrl());
  } catch (err) {
    console.error("photo/error", err);
    replyText(replyToken, "写真の保存に失敗しました。もう一度送ってみてください。");
  }
}

function fetchLineImageContent(messageId) {
  var lineToken = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var response = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/message/" + messageId + "/content", {
    method: "get",
    headers: { Authorization: "Bearer " + lineToken },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error("画像取得に失敗 (" + response.getResponseCode() + "): " + response.getContentText());
  }
  return response.getBlob();
}

function savePhotoToDrive(blob, messageId) {
  var folderId = PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID");
  if (!folderId) throw new Error("スクリプトプロパティに DRIVE_FOLDER_ID がありません（setupPhotoFolder を実行してください）");

  var folder = DriveApp.getFolderById(folderId);
  var ext = blob.getContentType() === "image/png" ? ".png" : ".jpg";
  var fileName = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss") + "_" + messageId + ext;
  blob.setName(fileName);
  var file = folder.createFile(blob);
  // 地図やカードの <img> に出すため、リンクを知っている人は見られるようにする
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

function buildThumbnailUrl(fileId) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";
}

function askPhoto(replyToken, locationId) {
  var quickReply = {
    items: [
      { type: "action", action: { type: "camera", label: "カメラを開く" } },
      { type: "action", action: { type: "cameraRoll", label: "写真を選ぶ" } },
      {
        type: "action",
        action: {
          type: "postback",
          label: "スキップ",
          data: JSON.stringify({ action: "skip_photo", locationId: locationId }),
          displayText: "スキップ"
        }
      }
    ]
  };
  replyTextWithQuickReply(replyToken, "写真があれば送ってください📷\nなければ「スキップ」を押してください", quickReply);
}

function setLocationPhoto(locationId, photoUrl) {
  var sheet = getOrCreateSheet(SHEET_NAMES.LOCATION);
  var match = sheet.getRange("C:C").createTextFinder(locationId).matchEntireCell(true).findNext();
  if (!match) return false;

  sheet.getRange(match.getRow(), 8).setValue(photoUrl);
  return true;
}

function savePhoto(userId, messageId, fileName, fileId, fileUrl) {
  var sheet = getOrCreateSheet(SHEET_NAMES.PHOTO);
  sheet.appendRow([new Date(), userId, messageId, fileName, fileId, fileUrl]);
}
```
:::

## FlexMessage.gs

:::details コード全体を見る
```javascript:FlexMessage.gs
function buildLocationFlexCarousel(results) {
  var mapUrl = ScriptApp.getService().getUrl() + "?view=map";
  var bubbles = results.map(function (r) {
    return {
      type: "bubble",
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "link", action: { type: "uri", label: "地図で見る", uri: mapUrl + "&id=" + encodeURIComponent(r.locationId) } }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: r.title, weight: "bold", size: "lg", wrap: true },
          { type: "text", text: r.address, size: "sm", color: "#888888", wrap: true },
          { type: "text", text: r.distanceKm.toFixed(2) + " km", size: "sm", margin: "md", color: "#4a86e8", weight: "bold" }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: "近い順に見つかった場所です",
    contents: { type: "carousel", contents: bubbles }
  };
}

/**
 * 登録が終わったときのカード。写真があれば一番上に出す。
 * place.answers は {1: "観光地", 2: "ぜひ"} の形、questions は getQuestions() の結果。
 */
function buildCompletionCard(place, questions) {
  var answerRows = questions.map(function (q, i) {
    return {
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: q.text, size: "sm", color: "#888888", flex: 4, wrap: true },
        { type: "text", text: place.answers[i + 1] || "-", size: "sm", weight: "bold", flex: 3, wrap: true }
      ]
    };
  });

  var bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: "登録しました！", size: "xs", color: "#4a86e8", weight: "bold" },
        { type: "text", text: place.title, weight: "bold", size: "lg", wrap: true },
        { type: "text", text: place.address, size: "sm", color: "#888888", wrap: true }
      ].concat(answerRows)
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "button", style: "primary", action: { type: "uri", label: "地図で見る", uri: ScriptApp.getService().getUrl() + "?view=map&id=" + encodeURIComponent(place.locationId) } }
      ]
    }
  };

  if (place.photoUrl) {
    bubble.hero = { type: "image", url: place.photoUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }

  return { type: "flex", altText: "登録しました：" + place.title, contents: bubble };
}

function replyFlex(replyToken, flexMessage) {
  reply(replyToken, [flexMessage]);
}
```
:::

## リッチメニュー.gs

:::details コード全体を見る
```javascript:リッチメニュー.gs
/**
 * GASエディタから直接実行する（doPostからは呼ばない、一度だけのセットアップ処理）。
 */
var RICH_MENU_IMAGE_URL = "https://raw.githubusercontent.com/LDGQ/assets/main/nara-line-location-log-handson/richmenu/richmenu-nara.png";

function setupRichMenu() {
  deleteAllRichMenus();
  var richMenuId = createRichMenu();
  uploadRichMenuImage(richMenuId, RICH_MENU_IMAGE_URL);
  setDefaultRichMenu(richMenuId);
  console.log("設定完了: " + richMenuId);
}

function deleteAllRichMenus() {
  var lineToken = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var response = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/list", {
    method: "get",
    headers: { Authorization: "Bearer " + lineToken }
  });

  (JSON.parse(response.getContentText()).richmenus || []).forEach(function (menu) {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/" + menu.richMenuId, {
      method: "delete",
      headers: { Authorization: "Bearer " + lineToken }
    });
    console.log("削除: " + menu.richMenuId);
  });
}

function createRichMenu() {
  var lineToken = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var mapUrl = ScriptApp.getService().getUrl() + "?view=map";
  var body = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "まちの記憶アーカイブ",
    chatBarText: "メニュー",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "記録・検索", uri: "https://line.me/R/nv/location" }
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: "uri", label: "地図を見る", uri: mapUrl }
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: "message", label: "地図を共有", text: "地図を共有" }
      }
    ]
  };

  var response = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + lineToken },
    payload: JSON.stringify(body)
  });
  return JSON.parse(response.getContentText()).richMenuId;
}

function uploadRichMenuImage(richMenuId, imageUrl) {
  var lineToken = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var imageBlob = UrlFetchApp.fetch(imageUrl).getBlob();

  UrlFetchApp.fetch("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content", {
    method: "post",
    contentType: "image/png",
    headers: { Authorization: "Bearer " + lineToken },
    payload: imageBlob
  });
}

function setDefaultRichMenu(richMenuId) {
  var lineToken = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  UrlFetchApp.fetch("https://api.line.me/v2/bot/user/all/richmenu/" + richMenuId, {
    method: "post",
    headers: { Authorization: "Bearer " + lineToken }
  });
}
```
:::

## OfficialData.gs

:::details コード全体を見る
```javascript:OfficialData.gs
/**
 * 公式データ（ハンズオン用のモック）。地図に灰色のピンで重ねる。
 */
var OFFICIAL_PLACES = [
  { title: "東大寺", address: "奈良県奈良市雑司町406-1", latitude: 34.6889, longitude: 135.8398, kind: "指定文化財" },
  { title: "春日大社", address: "奈良県奈良市春日野町160", latitude: 34.6814, longitude: 135.8481, kind: "指定文化財" },
  { title: "興福寺 五重塔", address: "奈良県奈良市登大路町48", latitude: 34.6851, longitude: 135.8325, kind: "指定文化財" },
  { title: "奈良国立博物館", address: "奈良県奈良市登大路町50", latitude: 34.6841, longitude: 135.8388, kind: "観光・文化施設" },
  { title: "ならまち格子の家", address: "奈良県奈良市元興寺町44", latitude: 34.6789, longitude: 135.8296, kind: "観光・文化施設" },
  { title: "奈良県立美術館", address: "奈良県奈良市登大路町10-6", latitude: 34.6847, longitude: 135.8342, kind: "観光・文化施設" }
];
```
:::

## マップ表示.gs

:::details コード全体を見る
```javascript:マップ表示.gs
function doGet(e) {
  var params = e.parameter;

  if (params.api === "locations") {
    return ContentService
      .createTextOutput(JSON.stringify(getMapData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return mapHtml(params.id);
}

function getMapData() {
  var questions = getQuestions();
  var categories = questions.length > 0
    ? questions[0].choices.filter(function (c) { return c !== ""; })
    : [];
  return {
    locations: getAllLocationsAsJson(),
    official: OFFICIAL_PLACES,
    categories: categories
  };
}

function getAllLocationsAsJson() {
  var photoUrls = readPhotoUrls();
  return readSubmissionWithAnswers().map(function (loc) {
    loc.photoUrl = photoUrls[loc.locationId] || "";
    return loc;
  });
}

/**
 * submission（全問に答えた場所）を、回答つきで読む。
 * 6列目以降が質問ごとの回答で、1行目に質問文が入っている。
 */
function readSubmissionWithAnswers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.SUBMISSION);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var width = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  var header = values[0];

  return values
    .slice(1)
    .filter(function (row) { return typeof row[3] === "number"; })
    .map(function (row) {
      var answers = [];
      for (var i = 5; i < width; i++) {
        if (header[i] !== "") answers.push({ question: String(header[i]), answer: String(row[i]) });
      }
      return { locationId: row[0], title: row[1], address: row[2], latitude: row[3], longitude: row[4], answers: answers };
    });
}

/**
 * location の H 列（写真URL）を 場所ID → URL の形で返す。写真が無い場所は入らない。
 */
function readPhotoUrls() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOCATION);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var values = sheet.getRange(2, 3, sheet.getLastRow() - 1, 6).getValues();
  var urls = {};
  values.forEach(function (row) {
    if (row[5]) urls[row[0]] = row[5];
  });
  return urls;
}

function mapHtml(focusId) {
  var apiUrl = ScriptApp.getService().getUrl() + "?api=locations";
  var script = [
    "var FOCUS_ID = " + JSON.stringify(focusId || "") + ";",
    "var COLORS = ['#d62828', '#1d4ed8', '#7e22ce', '#0f766e', '#a16207'];",
    "var map = L.map('map').setView([34.6851, 135.8048], 13);",
    "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {",
    "  attribution: '&copy; OpenStreetMap contributors'",
    "}).addTo(map);",
    "var group = L.markerClusterGroup({ maxClusterRadius: 40 }).addTo(map);",
    "function esc(s) {",
    "  return String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');",
    "}",
    "fetch('" + apiUrl + "').then(function (res) { return res.json(); }).then(function (data) {",
    "  var points = [];",
    "  data.official.forEach(function (p) {",
    "    L.circleMarker([p.latitude, p.longitude], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#555555', fillOpacity: 1 })",
    "      .addTo(group).bindPopup('<b>' + esc(p.title) + '</b><br>' + esc(p.kind) + '（公式）');",
    "    points.push([p.latitude, p.longitude]);",
    "  });",
    "  var focus = null;",
    "  data.locations.forEach(function (loc) {",
    "    var first = loc.answers.length > 0 ? loc.answers[0].answer : '';",
    "    var index = data.categories.indexOf(first);",
    "    var color = index >= 0 ? COLORS[index % COLORS.length] : '#333333';",
    "    var html = '';",
    "    if (loc.photoUrl) html += '<img src=\"' + esc(loc.photoUrl) + '\" style=\"width:200px;display:block;margin-bottom:6px\">';",
    "    html += '<b>' + esc(loc.title) + '</b><br>' + esc(loc.address);",
    "    loc.answers.forEach(function (a) { html += '<br>' + esc(a.question) + ' ' + esc(a.answer); });",
    "    var marker = L.circleMarker([loc.latitude, loc.longitude], { radius: 11, color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1 })",
    "      .addTo(group).bindPopup(html);",
    "    if (loc.locationId === FOCUS_ID) focus = marker;",
    "    points.push([loc.latitude, loc.longitude]);",
    "  });",
    "  if (focus) {",
    "    group.zoomToShowLayer(focus, function () { focus.openPopup(); });",
    "  } else if (points.length > 0) {",
    "    map.fitBounds(points, { padding: [30, 30] });",
    "  }",
    "});"
  ].join("\n");

  var html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css\">" +
    "<link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css\">" +
    "<link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css\">" +
    "<style>body{margin:0;}#map{height:100vh;}</style></head><body>" +
    "<div id=\"map\"></div>" +
    "<script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\"></script>" +
    "<script src=\"https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js\"></script>" +
    "<script>" + script + "</script></body></html>";
  return HtmlService.createHtmlOutput(html)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
```
:::

## QrCode.gs

:::details コード全体を見る
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

function replyMapQrCode(replyToken) {
  var mapUrl = ScriptApp.getService().getUrl() + "?view=map";
  var qrImageUrl = buildQrImageUrl(mapUrl);
  reply(replyToken, [
    { type: "text", text: "この QR コードから地図を開けます\n" + mapUrl },
    { type: "image", originalContentUrl: qrImageUrl, previewImageUrl: qrImageUrl }
  ]);
}

function replyQrCode(replyToken, placeName) {
  var basicId = PropertiesService.getScriptProperties().getProperty("LINE_BASIC_ID");
  if (!basicId) throw new Error("スクリプトプロパティに LINE_BASIC_ID を設定してください（例: @123abcde）");

  reply(replyToken, [buildQrImageMessage(basicId, placeName)]);
}
```
:::

## 一覧削除.gs

:::details コード全体を見る
```javascript:一覧削除.gs
function replyLocationList(replyToken) {
  var locations = readSubmission().reverse().slice(0, 5);
  if (locations.length === 0) {
    replyText(replyToken, "まだ何も登録されていません。位置情報を送って登録してみてください。");
    return;
  }

  var lines = locations.map(function (loc, i) {
    return (i + 1) + ". " + loc.title + "\n" + loc.address;
  });
  var bodyText = "登録された場所（新しい順）\n\n" + lines.join("\n\n");

  replyTextWithQuickReply(replyToken, bodyText, buildDeleteQuickReply(locations));
}

function buildDeleteQuickReply(locations) {
  return {
    items: locations.map(function (loc, i) {
      return {
        type: "action",
        action: {
          type: "postback",
          label: (i + 1) + "を削除",
          data: JSON.stringify({ action: "delete", locationId: loc.locationId }),
          displayText: (i + 1) + "番目を削除"
        }
      };
    })
  };
}

function handleDeletePostback(replyToken, locationId) {
  var deleted = deleteLocationRow(locationId);
  if (deleted) {
    replyText(replyToken, "削除しました。");
  } else {
    replyText(replyToken, "その場所は見つかりませんでした（すでに削除済みかもしれません）。");
  }
  return deleted;
}

/**
 * location から場所IDが一致する行を消す。submission は数式なので、そこからも消える。
 * ハンズオン用の割り切りで、ほかの人の登録も消せる。
 */
function deleteLocationRow(locationId) {
  var sheet = getOrCreateSheet(SHEET_NAMES.LOCATION);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][2] === locationId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}
```
:::

## appsscript.json

:::details 内容を見る
```json:appsscript.json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```
:::

お疲れさまでした。位置ログBot の全機能が、1つの GAS プロジェクトに収まりました。
