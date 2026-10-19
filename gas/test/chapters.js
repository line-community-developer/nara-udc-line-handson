// 本の章ごとのコード断片を、Qiita 記事のコードから順に当てていき、
// 最終形が gas/ と一致するかを確かめる。
// 実行: node gas/test/chapters.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "../..");
const BOOK = path.join(ROOT, "books/nara-line-location-log-handson");
const QIITA = path.join(ROOT, "docs/gas-line-bot-echo-json.md");
const GAS_DIR = path.join(__dirname, "..");

const problems = [];
const note = (msg) => problems.push(msg);

// ```javascript:FILE / ```diff:FILE を拾う（🎖️ 早く終わった人へ 以降は任意なので対象外）
function blocks(mdPath) {
  let src = fs.readFileSync(mdPath, "utf8");
  const cut = src.indexOf("## 🎖️ 早く終わった人へ");
  if (cut >= 0) src = src.slice(0, cut);
  const out = [];
  const re = /```(javascript|diff):([^\n]+)\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(src))) out.push({ kind: m[1], file: m[2].trim(), body: m[3] });
  return out;
}

// トップレベルの function / var 単位に分ける
function units(code) {
  const lines = code.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:function\s+([\w$]+)|var\s+([\w$]+))/);
    if (m) starts.push({ i, name: m[1] || m[2] });
  });
  return starts.map((s, k) => {
    let end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    // 次の定義の直前にあるコメント・空行は次の定義のもの
    while (end - 1 > s.i && /^(\s*$|\/\/|\/\*\*|\s*\*)/.test(lines[end - 1])) end--;
    return { name: s.name, text: lines.slice(s.i, end).join("\n") };
  });
}

const normalize = (t) =>
  t.replace(/\/\*\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "" && !/^\s*\/\//.test(l)).join("\n");

function applyJs(state, file, body, where) {
  let cur = state[file] || "";
  units(body).forEach((u) => {
    const existing = units(cur).find((x) => x.name === u.name);
    if (existing) cur = cur.replace(existing.text, u.text);
    else cur = cur.replace(/\n*$/, "\n\n") + u.text + "\n";
  });
  state[file] = cur;
}

function applyDiff(state, file, body, where) {
  const oldL = [], newL = [];
  body.split("\n").forEach((l) => {
    const c = l[0], rest = l.slice(1);
    if (c === "-") oldL.push(rest);
    else if (c === "+") newL.push(rest);
    else { oldL.push(l === "" ? "" : rest); newL.push(l === "" ? "" : rest); }
  });
  const oldT = oldL.join("\n"), newT = newL.join("\n");
  const cur = state[file] || "";
  const count = cur.split(oldT).length - 1;
  if (count !== 1) {
    note(`${where}: diff:${file} の前後の行が ${count === 0 ? "見つからない" : count + " 箇所に一致"}\n----\n${oldT}\n----`);
    return;
  }
  state[file] = cur.replace(oldT, newT);
}

function applyChapter(state, chapter) {
  blocks(path.join(BOOK, chapter + ".md")).forEach((b, i) => {
    const where = `${chapter} #${i + 1}`;
    if (b.kind === "diff") applyDiff(state, b.file, b.body, where);
    else applyJs(state, b.file, b.body, where);
  });
}

// 構文・重複定義・未定義関数の呼び出しを調べる
const BUILTIN = new Set("function if for while switch return catch JSON String Error Date Math Number encodeURIComponent decodeURIComponent parseInt fetch L".split(" "));
function lint(state, label) {
  const defined = {};
  Object.keys(state).forEach((f) => {
    try { new vm.Script(state[f], { filename: f }); } catch (e) { note(`${label}: ${f} が構文エラー: ${e.message}`); }
    units(state[f]).forEach((u) => {
      if (defined[u.name]) note(`${label}: ${u.name} が ${defined[u.name]} と ${f} で重複`);
      defined[u.name] = f;
    });
  });
  const local = new Set();
  Object.keys(state).forEach((f) => {
    const r = /var\s+([\w$]+)\s*=\s*function/g;
    let m;
    while ((m = r.exec(state[f]))) local.add(m[1]);
  });
  const seen = new Set();
  Object.keys(state).forEach((f) => {
    const code = state[f].replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const n = m[2];
      if (!defined[n] && !BUILTIN.has(n) && !local.has(n) && !seen.has(f + n) && seen.add(f + n)) note(`${label}: ${f} で未定義の ${n}() を呼んでいる`);
    }
  });
}

function snapshot(state) { return JSON.parse(JSON.stringify(state)); }

// ---- 1. Qiita → 02章 ----
const qiitaCode = blocks(QIITA).find((b) => b.kind === "javascript" && b.file === "コード.gs").body;
let state = { "コード.gs": qiitaCode + "\n" };
lint(state, "Qiita");
["02-01-receive-location", "02-02-state-management", "02-03-register-from-location", "02-03b-question-sheet", "02-04-gps-search"].forEach((ch) => {
  applyChapter(state, ch);
  lint(state, ch);
});
const after02 = snapshot(state);

// ---- 2. 03章を1つずつ単独で ----
const ch03 = ["03-01-photo-upload", "03-02-flex-message", "03-03-rich-menu", "03-04-map-display", "03-06-qr-code", "03-08-list-delete"];
ch03.forEach((ch) => {
  const s = snapshot(after02);
  applyChapter(s, ch);
  lint(s, ch + "（単独）");
});

// ---- 3. 全部当てて 04-01 / gas と比べる ----
ch03.forEach((ch) => applyChapter(state, ch));
lint(state, "全部盛り");
const finalFiles = fs.readdirSync(GAS_DIR).filter((f) => f.endsWith(".gs"));
finalFiles.forEach((f) => {
  const want = units(fs.readFileSync(path.join(GAS_DIR, f), "utf8"));
  const got = units(state[f] || "");
  want.forEach((u) => {
    const g = got.find((x) => x.name === u.name);
    if (!g) note(`最終形: ${f} の ${u.name} が章から作られない`);
    else if (normalize(g.text) !== normalize(u.text)) note(`最終形: ${f} の ${u.name} が gas/ と違う\n--- 章\n${normalize(g.text)}\n--- gas\n${normalize(u.text)}`);
  });
  got.forEach((u) => { if (!want.find((x) => x.name === u.name)) note(`最終形: ${f} に gas/ に無い ${u.name} がある`); });
  const order = (arr) => arr.map((u) => u.name).join(",");
  if (!problems.length && order(want) !== order(got)) console.log(`info: ${f} の関数の並び順が違う（動作には影響なし）`);
});
Object.keys(state).forEach((f) => { if (finalFiles.indexOf(f) < 0) note(`最終形: gas/ に無いファイル ${f}`); });

// 04-01 の本文と gas/ が一字一句同じか
const full = blocks(path.join(BOOK, "04-01-full-source.md"));
finalFiles.forEach((f) => {
  const b = full.find((x) => x.file === f);
  if (!b) note(`04-01 に ${f} が無い`);
  else if (b.body + "\n" !== fs.readFileSync(path.join(GAS_DIR, f), "utf8")) note(`04-01 の ${f} が gas/ と一字一句一致しない`);
});

// 章から組み立てたコードでモックテストも通す
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chapters-"));
Object.keys(state).forEach((f) => fs.writeFileSync(path.join(tmp, f), state[f]));
try {
  execFileSync("node", [path.join(__dirname, "run.js"), tmp], { stdio: "pipe" });
  console.log("ok   章から組み立てたコードで run.js が通る");
} catch (e) {
  note("章から組み立てたコードで run.js が失敗:\n" + e.stdout);
}

if (problems.length) {
  console.log(problems.map((p) => "NG   " + p).join("\n"));
  process.exit(1);
}
console.log("ok   Qiita → 02-01〜02-04 → 03章（単独・全部）が矛盾なく積み上がり、gas/ と一致");
