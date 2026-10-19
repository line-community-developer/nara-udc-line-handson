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
