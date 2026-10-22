// GAS のグローバルをメモリ上のモックに差し替えて、全 .gs を読み込み doPost を叩く。
// 実行: node gas/test/run.js
// 別ディレクトリの .gs を検証したいときは: node run.js <gasディレクトリ>
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const GAS_DIR = process.argv[2] || path.join(__dirname, "..");
const MAP_URL = "https://script.google.com/macros/s/DUMMY/exec";

// ---------- Spreadsheet モック ----------
function makeRange(sheet, row, col, numRows, numCols) {
  const range = {
    setNumberFormat: () => range,
    getValue: () => (sheet.rows[row - 1] || [])[col - 1],
    getValues: () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const src = sheet.rows[row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? "" : src[col - 1 + c]);
        out.push(line);
      }
      return out;
    },
    setValues: (values) => {
      values.forEach((line, r) => {
        const target = sheet.rows[row - 1 + r] || (sheet.rows[row - 1 + r] = []);
        line.forEach((v, c) => { target[col - 1 + c] = v; });
      });
      return range;
    },
    setValue: (v) => {
      const target = sheet.rows[row - 1] || (sheet.rows[row - 1] = []);
      target[col - 1] = v;
      return range;
    },
    setBackground: () => range,
    setFontColor: () => range,
    setFontWeight: () => range,
    // Range.createTextFinder（範囲内だけを探す）
    createTextFinder: (text) => makeTextFinder(sheet, text, { row, col, numRows, numCols })
  };
  return range;
}

// 実在する TextFinder のメソッドだけを持たせる（matchColumn などは無い）
function makeTextFinder(sheet, text, area) {
  let entire = false;
  const finder = {
    matchEntireCell: (b) => { entire = b; return finder; },
    matchCase: () => finder,
    findNext: () => {
      for (let r = 0; r < sheet.rows.length; r++) {
        if (area && (r + 1 < area.row || r + 1 >= area.row + area.numRows)) continue;
        const line = sheet.rows[r];
        for (let c = 0; c < line.length; c++) {
          if (area && (c + 1 < area.col || c + 1 >= area.col + area.numCols)) continue;
          const cell = String(line[c]);
          if (entire ? cell === String(text) : cell.indexOf(text) >= 0) {
            return { getRow: () => r + 1, getColumn: () => c + 1 };
          }
        }
      }
      return null;
    }
  };
  return finder;
}

function makeSheet(name) {
  const sheet = {
    name,
    rows: [],
    formulas: {}, // setFormula で渡された数式（キーは "A1" など）。Node では評価しない
    appendRow: (row) => { sheet.rows.push(row.slice()); return sheet; },
    setFrozenRows: () => sheet,
    getLastRow: () => sheet.rows.length,
    getLastColumn: () => Math.max(0, ...sheet.rows.map((r) => r.length)),
    deleteRow: (n) => { sheet.rows.splice(n - 1, 1); },
    getRange: (a, b, c, d) => {
      if (typeof a === "string") {
        // "A1" のようなセル指定（setFormula 用）
        const cell = a.match(/^([A-Z])(\d+)$/);
        if (cell) {
          const range = makeRange(sheet, Number(cell[2]), cell[1].charCodeAt(0) - 64, 1, 1);
          range.setFormula = (f) => { sheet.formulas[a] = f; return range; };
          return range;
        }
        // "A:A" のような列指定
        const col = a.charCodeAt(0) - 64;
        return makeRange(sheet, 1, col, 100000, 1);
      }
      return makeRange(sheet, a, b, c || 1, d || 1);
    },
    getDataRange: () => makeRange(sheet, 1, 1, sheet.rows.length, Math.max(0, ...sheet.rows.map((r) => r.length))),
    createTextFinder: (text) => makeTextFinder(sheet, text, null)
  };
  return sheet;
}

const sheets = {};
const spreadsheet = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n))
};

// ---------- その他のサービス ----------
const props = { LINE_ACCESS_TOKEN: "TEST_TOKEN", DRIVE_FOLDER_ID: "FOLDER1", LINE_BASIC_ID: "@123abcde" };
const fetches = [];
const driveFiles = [];
const sharings = [];

function makeBlob(type) {
  let name = "";
  return { getContentType: () => type, setName: (n) => { name = n; }, getName: () => name };
}

const context = {
  console: { log() {}, error: (...a) => { if (process.env.DEBUG) console.log("ERR", ...a); } },
  JSON, Math, Date, String, Error, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: {
    fetch: (url, opts) => {
      fetches.push({ url, opts: opts || {} });
      if (url.indexOf("https://api-data.line.me/v2/bot/message/") === 0) {
        return { getResponseCode: () => 200, getContentText: () => "", getBlob: () => makeBlob("image/jpeg") };
      }
      return { getResponseCode: () => 200, getContentText: () => "{\"richMenuId\":\"RM1\"}", getBlob: () => makeBlob("image/png") };
    }
  },
  ScriptApp: { getService: () => ({ getUrl: () => MAP_URL }) },
  ContentService: {
    MimeType: { JSON: "JSON" },
    createTextOutput: (t) => ({ text: t, setMimeType() { return this; } })
  },
  HtmlService: { createHtmlOutput: (h) => ({ html: h, meta: {}, addMetaTag(name, content) { this.meta[name] = content; return this; } }) },
  DriveApp: {
    createFolder: () => ({ getId: () => "FOLDER1", getUrl: () => "https://drive/FOLDER1" }),
    getFolderById: () => ({
      createFile: (blob) => {
        const id = "FILE" + (driveFiles.length + 1);
        driveFiles.push(blob.getName());
        return {
          getName: () => blob.getName(),
          getId: () => id,
          getUrl: () => "https://drive.google.com/file/d/" + id,
          setSharing: (access, permission) => { sharings.push([id, access, permission]); }
        };
      }
    }),
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
    Permission: { VIEW: "VIEW" }
  },
  Utilities: { formatDate: () => "20261001_120000" }
};
vm.createContext(context);
fs.readdirSync(GAS_DIR).filter((f) => f.endsWith(".gs")).forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), "utf8"), context, { filename: f });
});

// ---------- ヘルパー ----------
let seq = 0;
const USER = "Uuser1";
const OTHER = "Uother";
function post(event) {
  seq++;
  event.webhookEventId = event.webhookEventId || "01EVENT" + String(seq).padStart(4, "0");
  event.replyToken = "rt" + seq;
  event.source = { type: "user", userId: event.userId || USER };
  delete event.userId;
  const before = fetches.length;
  const ret = context.doPost({ postData: { contents: JSON.stringify({ destination: "x", events: [event] }) } });
  assert.strictEqual(ret, undefined, "doPost は何も return しない");
  const replies = fetches.slice(before).filter((f) => f.url === "https://api.line.me/v2/bot/message/reply");
  assert.strictEqual(replies.length, 1, "reply はちょうど1回");
  const payload = JSON.parse(replies[0].opts.payload);
  assert.strictEqual(payload.replyToken, event.replyToken);
  assert.strictEqual(replies[0].opts.headers.Authorization, "Bearer TEST_TOKEN");
  return { id: event.webhookEventId, messages: payload.messages };
}
const text = (t, userId) => post({ type: "message", userId, message: { type: "text", id: "m" + seq, text: t } });
// title / address を省きたいときは undefined を渡す（JSON に出ない）
const location = (title, lat, lng, address, userId) =>
  post({ type: "message", userId, message: { type: "location", id: "m" + seq, title, address: address === undefined ? title + "の住所" : address, latitude: lat, longitude: lng } });
const postback = (dataObj, displayText, userId) => post({ type: "postback", userId, postback: { data: JSON.stringify(dataObj), displayText } });
const rows = (name) => (sheets[name] ? sheets[name].rows.slice(1) : []);
const stateRows = (userId) => rows("state").filter((r) => r[0] === (userId || USER));
const stateOf = (userId) => { const r = stateRows(userId)[0]; return r && { status: r[1], payload: JSON.parse(r[2]), updatedAt: r[3] }; };
const qr = (msg) => msg.quickReply.items.map((it) => it.action);
const qrData = (msg, i) => JSON.parse(msg.quickReply.items[i].action.data);
const lastPostback = () => { const r = rows("postback"); return r[r.length - 1]; };
const RETRY = "もう一度位置情報を送ってください。";

// vm の別レルムの配列は deepStrictEqual で比べられないので JSON で比べる
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), (msg ? msg + ": " : "") + JSON.stringify(a) + " !== " + JSON.stringify(b));
const results = [];
function check(name, fn) {
  try { fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + "\n     " + e.message); }
}

const skipPhoto = (loc, userId) => postback({ action: "skip_photo", locationId: loc.id }, "スキップ", userId);

// 位置情報を送って、全問に答えて登録する（choices は問ごとの選択番号）
function register(title, lat, lng, choices, userId) {
  const loc = location(title, lat, lng, undefined, userId);
  postback({ action: "register", locationId: loc.id }, "この場所を登録する", userId);
  let r = skipPhoto(loc, userId);
  choices.forEach((c, i) => {
    r = postback({ action: "answer", locationId: loc.id, question: i + 1, choice: c }, "", userId);
  });
  return { id: loc.id, last: r };
}

// ---------- design.md 付録の数式 ----------
// setupSheets が setFormula に渡す文字列は、付録と一字一句同じでなければならない。
// spec は機能完成後に消すので、design.md が無いときは比較を飛ばす。
const DESIGN = path.join(__dirname, "../../../docs/specs/802-位置ログBot設計見直し/design.md");
function appendixFormula(heading) {
  const src = fs.readFileSync(DESIGN, "utf8");
  const i = src.indexOf("**" + heading + "**");
  assert.ok(i >= 0, "付録に " + heading + " が無い");
  const a = src.indexOf("```\n", i) + 4;
  return src.slice(a, src.indexOf("\n```", a));
}

// ---------- submission の代わり（パターン B と同じ規則を JS で） ----------
// Node では数式を評価できないので、location / postback / question から submission の行を作る。
// 規則: answer は action=answer・場所IDあり・選んだ文字が取れる行だけ。選んだ文字は question の (問番号, 選択番号) のセル。
//       同じ場所・同じ問は一番新しい回答。今ある全質問（A列が空でない行）に答えた場所だけを出す。
function fakeSubmission() {
  const qRows = rows("question");
  const qs = qRows.map((r) => r[0]).filter((t) => t !== "");
  const pick = (js, re) => { const m = String(js).match(re); return m ? m[1] : ""; };
  const answers = rows("postback").map((r) => {
    const js = r[4];
    const act = pick(js, /"action"\s*:\s*"([^"]*)"/);
    const loc = pick(js, /"locationId"\s*:\s*"([^"]*)"/);
    const q = Number(pick(js, /"question"\s*:\s*(\d+)/)) || 0;
    const c = Number(pick(js, /"choice"\s*:\s*(\d+)/)) || 0;
    const txt = q >= 1 && c >= 1 && c <= 5 && qRows[q - 1] ? String(qRows[q - 1][c] === undefined ? "" : qRows[q - 1][c]) : "";
    return { act, loc, q, txt };
  }).filter((a) => a.act === "answer" && a.loc !== "" && a.txt !== "");
  const latest = (loc, k) => { let t = "無回答"; answers.forEach((a) => { if (a.loc === loc && a.q === k) t = a.txt; }); return t; };
  const out = [["場所のID", "タイトル", "住所", "緯度", "経度"].concat(qs)];
  rows("location")
    .filter((r) => r[2] !== "" && answers.some((a) => a.loc === r[2]))
    .forEach((r) => {
      const ans = qs.map((_, k) => latest(r[2], k + 1));
      if (ans.indexOf("無回答") < 0) out.push(r.slice(2, 7).concat(ans));
    });
  if (out.length === 1) out.push(["（全問に答えた場所はまだありません）"]);
  (sheets.submission || spreadsheet.insertSheet("submission")).rows = out;
  return out.slice(1).filter((r) => r.length > 1);
}

// ---------- ケース ----------
check("テキスト → 位置情報クイックリプライ / log", () => {
  const r = text("こんにちは");
  assert.strictEqual(r.messages.length, 1);
  assert.strictEqual(r.messages[0].text, "登録・検索したい場所の位置情報を送ってください");
  eq(qr(r.messages[0]), [{ type: "location", label: "位置情報を送る" }]);
  eq(sheets.log.rows[0], ["記録日時", "ユーザーID", "イベント種別", "JSON"]);
  const log = rows("log")[0];
  assert.strictEqual(log[1], USER);
  assert.strictEqual(log[2], "message");
  assert.strictEqual(JSON.parse(log[3]).message.text, "こんにちは");
  assert.strictEqual(sheets.state, undefined, "テキストでは state を作らない");
});

let first;
check("位置情報 → location に1行 / state(pending_choice) / 選択ボタン", () => {
  first = location("東京タワー", 35.6586, 139.7454);
  assert.strictEqual(first.messages[0].text, "受け取った位置情報\nタイトル: 東京タワー\n住所: 東京タワーの住所");
  eq(qr(first.messages[0]).map((a) => [a.type, a.label, a.displayText]), [
    ["postback", "この場所を登録する", "この場所を登録する"],
    ["postback", "近くを検索する", "近くを検索する"]
  ]);
  eq(qrData(first.messages[0], 0), { action: "register", locationId: first.id });
  eq(qrData(first.messages[0], 1), { action: "search", locationId: first.id });
  eq(sheets.location.rows[0], ["送信日時", "ユーザーID", "メッセージID", "タイトル", "住所", "緯度", "経度", "写真URL"]);
  eq(rows("location"), [[rows("location")[0][0], USER, first.id, "東京タワー", "東京タワーの住所", 35.6586, 139.7454]]);
  assert.ok(rows("location")[0][0] instanceof Date);
  eq(sheets.state.rows[0], ["user_id", "status", "payload", "updated_at"]);
  assert.strictEqual(stateRows().length, 1);
  const s = stateOf();
  assert.strictEqual(s.status, "pending_choice");
  eq(s.payload, { locationId: first.id, title: "東京タワー", address: "東京タワーの住所", latitude: 35.6586, longitude: 139.7454 });
  assert.ok(s.updatedAt instanceof Date);
});

check("title 無し → 住所で代用 / 住所も無し → 名前のない場所", () => {
  const a = location(undefined, 35.1, 139.1, "東京都港区芝公園");
  assert.strictEqual(a.messages[0].text, "受け取った位置情報\nタイトル: 東京都港区芝公園\n住所: 東京都港区芝公園");
  const rowA = rows("location").find((r) => r[2] === a.id);
  eq(rowA.slice(3, 5), ["東京都港区芝公園", "東京都港区芝公園"]);
  const b = location("", 35.2, 139.2, "");
  assert.strictEqual(b.messages[0].text, "受け取った位置情報\nタイトル: 名前のない場所\n住所: ");
  assert.ok(b.messages[0].text.indexOf("undefined") < 0);
  eq(rows("location").find((r) => r[2] === b.id).slice(3, 5), ["名前のない場所", ""]);
  assert.strictEqual(stateRows().length, 1, "位置情報を何回送っても state はその人の1行");
  assert.strictEqual(stateOf().payload.locationId, b.id, "後に送った場所で上書き");
});

check("setupSheets 前に登録 → 質問が見つからない案内（state は回答待ちのまま）", () => {
  const loc = location("試し", 35.3, 139.3);
  postback({ action: "register", locationId: loc.id }, "この場所を登録する");
  const r = skipPhoto(loc);
  assert.strictEqual(r.messages[0].text, "質問が見つかりません。question シートを確かめてください（setupSheets を実行）。");
  assert.strictEqual(stateOf().status, "answering");
  assert.strictEqual(stateOf().payload.question, 1);
});

check("setupSheets → question（サンプル2問）/ answer / submission の数式", () => {
  context.setupSheets();
  eq(sheets.question.rows, [
    ["質問", "選択肢1", "選択肢2", "選択肢3", "選択肢4", "選択肢5"],
    ["何がある？", "石仏・お地蔵さん", "道標・石碑", "古い町家", "井戸・水路", "その他"],
    ["どのくらい古そう？", "とても古そう", "少し古そう", "わからない", "", ""]
  ]);
  assert.ok(sheets.postback, "postback も先に作る");
  eq(Object.keys(sheets.answer.formulas).sort(), ["A1", "H1"]);
  eq(Object.keys(sheets.submission.formulas), ["A1"]);
  if (fs.existsSync(DESIGN)) {
    assert.strictEqual(sheets.answer.formulas.A1, appendixFormula("answer!A1"), "answer!A1 が付録と違う");
    assert.strictEqual(sheets.answer.formulas.H1, appendixFormula("answer!H1"), "answer!H1 が付録と違う");
    assert.strictEqual(sheets.submission.formulas.A1, appendixFormula("submission_B!A1"), "submission!A1 が付録（パターン B）と違う");
    assert.ok(sheets.answer.formulas.H1.indexOf('(act="answer")*') >= 0, "answer!H1 は修正後（action=answer の行だけ）");
  } else {
    console.log("info: design.md が無いので、数式と付録の比較は飛ばした");
  }
  // 再実行しても question を上書きしない
  sheets.question.rows[1][1] = "喫茶店";
  context.setupSheets();
  assert.strictEqual(sheets.question.rows.length, 3);
  assert.strictEqual(sheets.question.rows[1][1], "喫茶店");
  sheets.question.rows[1][1] = "石仏・お地蔵さん";
});

let registered;
check("登録 → 問1 → 問2 → 登録しました（postback / state）", () => {
  const loc = location("東京タワー", 35.6586, 139.7454);
  const r0 = postback({ action: "register", locationId: loc.id }, "この場所を登録する");
  eq(lastPostback().slice(1), [USER, r0.id, loc.id, JSON.stringify({ action: "register", locationId: loc.id }), "この場所を登録する"]);
  assert.ok(r0.messages[0].text.indexOf("写真があれば送ってください") === 0);
  eq(qr(r0.messages[0]).map((a) => [a.type, a.label]), [["camera", "カメラを開く"], ["cameraRoll", "写真を選ぶ"], ["postback", "スキップ"]]);
  eq(qrData(r0.messages[0], 2), { action: "skip_photo", locationId: loc.id });
  assert.strictEqual(stateOf().status, "waiting_photo");
  const r1 = skipPhoto(loc);
  assert.strictEqual(r1.messages[0].text, "問1. 何がある？");
  eq(qr(r1.messages[0]).map((a) => [a.type, a.label, a.displayText]),
    ["石仏・お地蔵さん", "道標・石碑", "古い町家", "井戸・水路", "その他"].map((c) => ["postback", c, c]));
  eq(qr(r1.messages[0]).map((a) => JSON.parse(a.data)),
    [1, 2, 3, 4, 5].map((c) => ({ action: "answer", locationId: loc.id, question: 1, choice: c })));
  assert.strictEqual(stateOf().status, "answering");
  assert.strictEqual(stateOf().payload.question, 1);

  const r2 = postback(qrData(r1.messages[0], 3), "井戸・水路");
  eq(lastPostback().slice(2), [r2.id, loc.id, JSON.stringify({ action: "answer", locationId: loc.id, question: 1, choice: 4 }), "井戸・水路"]);
  assert.strictEqual(r2.messages[0].text, "問2. どのくらい古そう？");
  eq(qr(r2.messages[0]).map((a) => a.label), ["とても古そう", "少し古そう", "わからない"]);
  eq(qr(r2.messages[0]).map((a) => JSON.parse(a.data).choice), [1, 2, 3]);
  assert.strictEqual(stateOf().payload.question, 2);
  eq(stateOf().payload.answers, { 1: "井戸・水路" });

  const r3 = postback(qrData(r2.messages[0], 0), "とても古そう");
  const card = r3.messages[0];
  assert.strictEqual(card.type, "flex");
  assert.strictEqual(card.altText, "登録しました：東京タワー");
  assert.strictEqual(card.contents.hero, undefined, "写真なしならカードに画像は出ない");
  const cardTexts = JSON.stringify(card.contents.body);
  ["東京タワー", "東京タワーの住所", "何がある？", "井戸・水路", "どのくらい古そう？", "とても古そう"].forEach((t) => assert.ok(cardTexts.indexOf(t) >= 0, "カードに " + t));
  eq(card.contents.footer.contents[0].action, { type: "uri", label: "地図で見る", uri: MAP_URL + "?view=map&id=" + encodeURIComponent(loc.id) });
  eq(stateRows()[0].slice(0, 3), [USER, "done", "{}"]);
  assert.strictEqual(stateRows().length, 1);
  assert.strictEqual(rows("postback").filter((r) => r[3] === loc.id && JSON.parse(r[4]).action === "answer").length, 2);
  registered = loc.id;
});

check("二度押し・古いボタン・30分超・state 無し → 再送案内 / 断ったボタンは postback に残さない", () => {
  const pb = () => rows("postback").length;
  const lg = () => rows("log").length;
  // 断ったボタンは postback に1行も増えず、log には1行増える
  const rejected = (dataObj, userId, why) => {
    const p = pb(), l = lg();
    const r = postback(dataObj, "", userId);
    assert.strictEqual(r.messages[0].text, RETRY, why);
    assert.strictEqual(pb(), p, why + ": postback に残さない");
    assert.strictEqual(lg(), l + 1, why + ": log には残る");
  };
  rejected({ action: "answer", locationId: registered, question: 2, choice: 1 }, undefined, "登録完了後の二度押し");

  const a = location("A", 35.0, 135.0);
  const b = location("B", 35.1, 135.1);
  rejected({ action: "register", locationId: a.id }, undefined, "前の場所のボタン");
  let n = pb();
  postback({ action: "register", locationId: b.id });
  rejected({ action: "answer", locationId: b.id, question: 1, choice: 1 }, undefined, "写真を飛ばして回答");
  assert.strictEqual(skipPhoto(b).messages[0].text, "問1. 何がある？");
  rejected({ action: "skip_photo", locationId: b.id }, undefined, "スキップの二度押し");
  n = pb();
  postback({ action: "answer", locationId: b.id, question: 1, choice: 1 });
  assert.strictEqual(pb(), n + 1, "受け付けた回答は postback に残る");
  rejected({ action: "answer", locationId: b.id, question: 1, choice: 2 }, undefined, "同じ問の二度押し");
  rejected({ action: "search", locationId: b.id }, undefined, "回答中に検索ボタン");
  eq(stateOf().payload.answers, { 1: "石仏・お地蔵さん" }, "二度押しは state に入らない");

  stateRows()[0][3] = new Date(Date.now() - 31 * 60 * 1000);
  rejected({ action: "answer", locationId: b.id, question: 2, choice: 1 }, undefined, "30分超");
  rejected({ action: "register", locationId: b.id }, "Unobody", "state 無し");

  // 断った回答は submission に入らない（B は問1しか受け付けていない）
  assert.ok(!fakeSubmission().some((r) => r[0] === b.id), "断った回答で登録が完成しない");
  assert.ok(!rows("postback").some((r) => r[3] === b.id && JSON.parse(r[4]).question === 2), "問2の回答は postback に無い");
});

check("空欄の選択肢はボタンにしない（番号は詰めない）/ ラベルは20文字で切る", () => {
  sheets.question.rows.push(["どの季節？", "", "春のとても長い名前の選択肢を二十文字より長くしてみる", "", "秋", ""]);
  const loc = location("季節テスト", 35.5, 139.5);
  postback({ action: "register", locationId: loc.id });
  skipPhoto(loc);
  postback({ action: "answer", locationId: loc.id, question: 1, choice: 1 });
  const r = postback({ action: "answer", locationId: loc.id, question: 2, choice: 1 });
  assert.strictEqual(r.messages[0].text, "問3. どの季節？");
  const acts = qr(r.messages[0]);
  eq(acts.map((a) => JSON.parse(a.data).choice), [2, 4]);
  assert.strictEqual(acts[0].label, "春のとても長い名前の選択肢を二十文字より");
  assert.strictEqual(acts[0].label.length, 20);
  assert.strictEqual(acts[0].displayText, "春のとても長い名前の選択肢を二十文字より長くしてみる");
  const done = postback(JSON.parse(acts[0].data), acts[0].displayText);
  assert.strictEqual(done.messages[0].type, "flex");
  assert.ok(JSON.stringify(done.messages[0].contents.body).indexOf("春のとても長い名前の選択肢を二十文字より長くしてみる") >= 0);
  sheets.question.rows.pop();
});

check("fakeSubmission（パターン B）: 全問答えた場所だけ / 途中でやめた場所は出ない / 最新の回答", () => {
  const mid = location("途中でやめる", 35.6, 139.6);
  postback({ action: "register", locationId: mid.id });
  skipPhoto(mid);
  postback({ action: "answer", locationId: mid.id, question: 1, choice: 2 });
  location("次の場所", 35.61, 139.61); // ここで会話が切り替わる
  const sub = fakeSubmission();
  eq(sheets.submission.rows[0], ["場所のID", "タイトル", "住所", "緯度", "経度", "何がある？", "どのくらい古そう？"]);
  assert.ok(sub.some((r) => r[0] === registered), "全問答えた場所は出る");
  assert.ok(!sub.some((r) => r[0] === mid.id), "途中でやめた場所は出ない");
  eq(sub.find((r) => r[0] === registered), [registered, "東京タワー", "東京タワーの住所", 35.6586, 139.7454, "井戸・水路", "とても古そう"]);
  // 季節テストの場所は、問3を消したあとも問1・問2に答えているので出る
  assert.strictEqual(sub.length, 2);
  // 同じ場所・同じ問に回答が2つあれば新しい方（Bot は二度押しを断るので、手で足したときだけ起きる）
  sheets.postback.rows.push([new Date(), USER, "manual", registered, JSON.stringify({ action: "answer", locationId: registered, question: 1, choice: 1 }), ""]);
  try {
    eq(fakeSubmission().find((r) => r[0] === registered).slice(5), ["石仏・お地蔵さん", "とても古そう"]);
  } finally {
    sheets.postback.rows.pop();
  }
  eq(fakeSubmission().find((r) => r[0] === registered).slice(5), ["井戸・水路", "とても古そう"]);
});

check("質問を後から足すと、過去の登録は submission からいったん消える", () => {
  const before = fakeSubmission().length;
  sheets.question.rows.push(["見つけたきっかけは？", "散歩中", "通勤・通学中", "人に教わった", "", ""]);
  try {
    const sub = fakeSubmission();
    eq(sheets.submission.rows[0].slice(5), ["何がある？", "どのくらい古そう？", "見つけたきっかけは？"]);
    assert.ok(!sub.some((r) => r[0] === registered), "問3に答えていない登録は消える");
    // 季節テストは、前に消した問3「どの季節？」への回答（選択番号2）が「通勤・通学中」に読み替わって残る
    // ＝「question の行を入れ替えると過去の回答がずれる」制約そのもの
    eq(sub.map((r) => [r[1], r[7]]), [["季節テスト", "通勤・通学中"]]);
  } finally {
    sheets.question.rows.pop();
  }
  assert.strictEqual(fakeSubmission().length, before, "質問を戻すと元に戻る");
});

check("検索 → submission から近い順の Flex（今の場所は出ない・保存もされない）", () => {
  const before = fakeSubmission().length;
  const here = location("浜松町駅", 35.6553, 139.7571);
  const r = postback({ action: "search", locationId: here.id }, "近くを検索する");
  const m = r.messages[0];
  assert.strictEqual(m.type, "flex");
  assert.strictEqual(m.altText, "近い順に見つかった場所です");
  const texts = m.contents.contents.map((b) => b.body.contents.map((c) => c.text));
  eq(texts.map((t) => t[0]), ["東京タワー", "季節テスト"]);
  const buttonUris = m.contents.contents.map((b) => b.footer.contents[0].action.uri);
  assert.ok(buttonUris.every((u) => u.indexOf(MAP_URL + "?view=map&id=") === 0), "カードのボタンは、その場所に寄せた地図を開く");
  eq(buttonUris.map((u) => decodeURIComponent(u.split("&id=")[1])), m.contents.contents.map((_, i) => buttonUris[i].split("&id=")[1] && decodeURIComponent(buttonUris[i].split("&id=")[1])));
  assert.ok(texts.every((t) => t.every((x) => typeof x === "string" && x !== "")), "Flex の text は空にしない");
  assert.ok(/^\d+\.\d\d km$/.test(texts[0][2]));
  eq(stateRows()[0].slice(0, 2), [USER, "done"]);
  assert.strictEqual(fakeSubmission().length, before, "検索に使った場所は submission に増えない");
});

check("検索 → submission が空なら案内", () => {
  const saved = sheets.submission.rows;
  sheets.submission.rows = [saved[0], ["（全問に答えた場所はまだありません）"]];
  const here = location("どこか", 35.0, 139.0);
  const r = postback({ action: "search", locationId: here.id });
  assert.strictEqual(r.messages[0].text, "登録された場所がまだありません。まずは場所を1件登録してみてください。");
  sheets.submission.rows = saved;
});

check("一覧（全員分・新しい順）→ ほかの人でも削除 → location と submission から消える", () => {
  const other = register("大阪城", 34.6873, 135.5262, [3, 1], OTHER);
  assert.strictEqual(other.last.messages[0].type, "flex");
  fakeSubmission();
  const r = text("一覧");
  const m = r.messages[0];
  assert.strictEqual(m.text, "登録された場所（新しい順）\n\n1. 大阪城\n大阪城の住所\n\n2. 季節テスト\n季節テストの住所\n\n3. 東京タワー\n東京タワーの住所");
  eq(qr(m).map((a) => [a.label, a.displayText]), [["1を削除", "1番目を削除"], ["2を削除", "2番目を削除"], ["3を削除", "3番目を削除"]]);
  eq(qrData(m, 0), { action: "delete", locationId: other.id });

  const d = postback(qrData(m, 2), "3番目を削除", OTHER);
  assert.strictEqual(d.messages[0].text, "削除しました。", "ほかの人の登録も消せる");
  eq(lastPostback().slice(1, 4), [OTHER, d.id, registered]);
  assert.ok(!rows("location").some((r) => r[2] === registered));
  assert.ok(!fakeSubmission().some((r) => r[0] === registered), "submission からも消える");
  const n = rows("postback").length;
  const again = postback(qrData(m, 2));
  assert.strictEqual(again.messages[0].text, "その場所は見つかりませんでした（すでに削除済みかもしれません）。");
  assert.strictEqual(rows("postback").length, n, "消せなかった削除は postback に残さない");
});

check("一覧 → 登録が無ければ案内", () => {
  const saved = sheets.submission.rows;
  sheets.submission.rows = [saved[0], ["（全問に答えた場所はまだありません）"]];
  assert.strictEqual(text("一覧").messages[0].text, "まだ何も登録されていません。位置情報を送って登録してみてください。");
  sheets.submission.rows = saved;
});

check("マップ → URL / doGet は submission の場所だけ", () => {
  const r = text("マップ");
  assert.strictEqual(r.messages[0].text, "マップを開く: " + MAP_URL + "?view=map");
  const data = JSON.parse(context.doGet({ parameter: { api: "locations" } }).text);
  const json = data.locations;
  eq(json.map((l) => [l.title, l.address, l.latitude, l.longitude]), fakeSubmission().map((s) => [s[1], s[2], s[3], s[4]]));
  assert.ok(json.length < rows("location").length, "検索用・途中の場所は出ない");
  eq(json[0].answers.map((a) => a.question), ["何がある？", "どのくらい古そう？"]);
  eq(data.categories, ["石仏・お地蔵さん", "道標・石碑", "古い町家", "井戸・水路", "その他"]);
  eq(data.official.length, 6);
  assert.strictEqual(data.official[0].title, "東大寺");
  const page = context.doGet({ parameter: { view: "map" } });
  eq(page.meta.viewport, "width=device-width, initial-scale=1", "スマホで縮小表示にならない");
  const html = page.html;
  assert.ok(html.indexOf(MAP_URL + "?api=locations") >= 0);
  assert.ok(html.indexOf('var FOCUS_ID = "";') >= 0, "id が無ければ全体を出す");
  const focused = context.doGet({ parameter: { view: "map", id: "01EVENT0042" } }).html;
  assert.ok(focused.indexOf('var FOCUS_ID = "01EVENT0042";') >= 0, "id があればその場所に寄せる");
});

check("画像 → Drive 保存 / photo シート", () => {
  const r = post({ type: "message", message: { type: "image", id: "IMG123", contentProvider: { type: "line" } } });
  assert.ok(r.messages[0].text.indexOf("写真を保存しました！") === 0);
  const f = fetches.find((x) => x.url === "https://api-data.line.me/v2/bot/message/IMG123/content");
  assert.ok(f, "api-data.line.me から取得している");
  const p = rows("photo")[0];
  eq(p.slice(1, 5), [USER, "IMG123", "20261001_120000_IMG123.jpg", "FILE1"]);
});

check("外部 contentProvider の画像は保存しない", () => {
  const n = rows("photo").length;
  const r = post({ type: "message", message: { type: "image", id: "IMG9", contentProvider: { type: "external" } } });
  assert.ok(r.messages[0].text.indexOf("対応していない") >= 0);
  assert.strictEqual(rows("photo").length, n);
});

check("写真 → 登録中の場所に紐づけて問1へ / スキップしなくても進める", () => {
  const loc = location("写真つき", 34.69, 135.83);
  postback({ action: "register", locationId: loc.id }, "この場所を登録する");
  const r = post({ type: "message", message: { type: "image", id: "IMG200", contentProvider: { type: "line" } } });
  assert.strictEqual(r.messages[0].text, "写真を保存しました！\n問1. 何がある？");
  eq(qr(r.messages[0]).map((a) => JSON.parse(a.data).locationId), [loc.id, loc.id, loc.id, loc.id, loc.id]);
  assert.strictEqual(stateOf().status, "answering");
  const file = driveFiles.length;
  const photoUrl = "https://drive.google.com/thumbnail?id=FILE" + file + "&sz=w400";
  assert.strictEqual(stateOf().payload.photoUrl, photoUrl);
  assert.strictEqual(rows("location").find((x) => x[2] === loc.id)[7], photoUrl);
  assert.ok(sharings.some((x) => x[0] === "FILE" + file && x[1] === "ANYONE_WITH_LINK" && x[2] === "VIEW"), "リンクを知っている人は見られる");
  const done = postback({ action: "answer", locationId: loc.id, question: 1, choice: 3 }, "古い町家");
  const last = postback({ action: "answer", locationId: loc.id, question: 2, choice: 1 }, "とても古そう");
  assert.strictEqual(last.messages[0].contents.hero.url, photoUrl);
  assert.strictEqual(last.messages[0].contents.hero.type, "image");
});

check("写真 → 状態なしなら従来どおり保存だけ（location には紐づかない）", () => {
  const n = rows("location").filter((x) => x[7]).length;
  const r = post({ type: "message", userId: "Unobody2", message: { type: "image", id: "IMG300", contentProvider: { type: "line" } } });
  assert.ok(r.messages[0].text.indexOf("写真を保存しました！\nhttps://") === 0);
  assert.strictEqual(rows("location").filter((x) => x[7]).length, n);
});

check("QR発行 東京タワー → 画像メッセージ", () => {
  const r = text("QR発行 東京タワー");
  const m = r.messages[0];
  assert.strictEqual(m.type, "image");
  assert.strictEqual(m.originalContentUrl, m.previewImageUrl);
  const data = decodeURIComponent(m.originalContentUrl.split("&data=")[1]);
  assert.strictEqual(data, "https://line.me/R/oaMessage/@123abcde/?" + encodeURIComponent("訪問: 東京タワー"));
});

check("地図を共有 → 地図 URL の QR 画像", () => {
  const r = text("地図を共有");
  assert.strictEqual(r.messages.length, 2);
  assert.ok(r.messages[0].text.indexOf(MAP_URL + "?view=map") >= 0);
  assert.strictEqual(r.messages[1].type, "image");
  assert.strictEqual(decodeURIComponent(r.messages[1].originalContentUrl.split("&data=")[1]), MAP_URL + "?view=map");
});

check("log シートに全イベントが残る", () => {
  assert.strictEqual(rows("log").length, seq);
});

check("setupRichMenu が 3 回 API を叩く", () => {
  const before = fetches.length;
  context.setupRichMenu();
  const urls = fetches.slice(before).map((f) => f.url.replace(/\/\{?[^/]*$/, ""));
  assert.ok(fetches.slice(before).some((f) => f.url === "https://api.line.me/v2/bot/richmenu"));
  assert.ok(fetches.slice(before).some((f) => f.url.indexOf("https://api-data.line.me/v2/bot/richmenu/") === 0));
  assert.ok(fetches.slice(before).some((f) => f.url.indexOf("https://api.line.me/v2/bot/user/all/richmenu/") === 0));
  assert.ok(urls.length >= 3);
  const menu = JSON.parse(fetches.slice(before).find((f) => f.url === "https://api.line.me/v2/bot/richmenu").opts.payload);
  eq(menu.size, { width: 2500, height: 843 });
  eq(menu.areas.map((a) => a.action.type), ["uri", "uri", "message"]);
  assert.strictEqual(menu.areas[0].action.uri, "https://line.me/R/nv/location");
  assert.strictEqual(menu.areas[1].action.uri, MAP_URL + "?view=map");
  assert.strictEqual(menu.areas[2].action.text, "地図を共有");
  assert.strictEqual(menu.areas.reduce((w, a) => w + a.bounds.width, 0), 2500);
});

console.log(results.join("\n"));
if (results.some((r) => r.indexOf("FAIL") === 0)) process.exit(1);
