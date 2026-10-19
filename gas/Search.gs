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
