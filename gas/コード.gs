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
