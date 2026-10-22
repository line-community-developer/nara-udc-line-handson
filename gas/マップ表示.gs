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
    "var map = L.map('map').setView([34.6850, 135.8350], 14);",
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
