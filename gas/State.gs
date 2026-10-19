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
