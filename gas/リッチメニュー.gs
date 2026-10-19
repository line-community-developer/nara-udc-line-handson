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
