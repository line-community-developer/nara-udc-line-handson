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
