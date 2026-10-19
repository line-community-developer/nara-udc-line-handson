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
