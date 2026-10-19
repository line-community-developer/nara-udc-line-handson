// リッチメニューを LINE に登録する（ローカル実行）。画像は assets/richmenu.png を直接アップロードする。
//
// 使い方:
//   LINE_ACCESS_TOKEN=xxxx node scripts/register-richmenu.mjs            # 作成 → 画像 → デフォルトに設定
//   LINE_ACCESS_TOKEN=xxxx node scripts/register-richmenu.mjs --replace  # 既存メニューを全部消してから登録
//   node scripts/register-richmenu.mjs --dry-run                         # 送る内容だけ表示（トークン不要）
//
// 環境変数:
//   LINE_ACCESS_TOKEN  チャネルアクセストークン（長期）
//   MAP_URL            地図の URL（省略時は本番デプロイの ?view=map）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_MAP_URL =
  "https://script.google.com/macros/s/AKfycbwcs_U7Jd2gkEq-gLyqqOI4Zq6zDMA-M5XXDLXf8oijwXdrPxy30zczKaij5vpiJzVF/exec?view=map";
const IMAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../assets/richmenu.png");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const replace = args.has("--replace");
const token = process.env.LINE_ACCESS_TOKEN;
const mapUrl = process.env.MAP_URL || DEFAULT_MAP_URL;

const richMenu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: "まちの記憶アーカイブ",
  chatBarText: "メニュー",
  areas: [
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "記録・検索", uri: "https://line.me/R/nv/location" } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: "uri", label: "地図を見る", uri: mapUrl } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: "message", label: "地図を共有", text: "地図を共有" } }
  ]
};

if (dryRun) {
  console.log(JSON.stringify(richMenu, null, 2));
  console.log(`image: ${IMAGE_PATH} (${readFileSync(IMAGE_PATH).length} bytes)`);
  console.log(`replace: ${replace}`);
  process.exit(0);
}
if (!token) {
  console.error("LINE_ACCESS_TOKEN を環境変数で渡してください");
  process.exit(1);
}

async function line(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url} → ${res.status} ${body}`);
  return body ? JSON.parse(body) : {};
}

if (replace) {
  const { richmenus } = await line("https://api.line.me/v2/bot/richmenu/list");
  for (const m of richmenus) {
    await line(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
    console.log(`削除: ${m.richMenuId} (${m.name})`);
  }
}

const { richMenuId } = await line("https://api.line.me/v2/bot/richmenu", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(richMenu)
});
console.log(`作成: ${richMenuId}`);

await line(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST",
  headers: { "Content-Type": "image/png" },
  body: readFileSync(IMAGE_PATH)
});
console.log("画像アップロード: OK");

await line(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });
console.log("デフォルトに設定: OK");
