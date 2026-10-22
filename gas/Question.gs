/**
 * 質問マスタ（question シート）
 * 1行が1問。A列が質問文、B〜F列が選択肢1〜5（空欄は使わない）。
 * setupSheets をエディタから1回実行すると、question・answer・submission ができる。
 */

var QUESTION_HEADERS = ["質問", "選択肢1", "選択肢2", "選択肢3", "選択肢4", "選択肢5"];

var SAMPLE_QUESTIONS = [
  ["何がある？", "石仏・お地蔵さん", "道標・石碑", "古い町家", "井戸・水路", "その他"],
  ["どのくらい古そう？", "とても古そう", "少し古そう", "わからない", "", ""]
];

function getQuestions() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.QUESTION);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var questions = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === "") break;
    questions.push({
      text: String(values[i][0]),
      choices: values[i].slice(1).map(function (v) { return String(v); })
    });
  }
  return questions;
}

function askQuestion(replyToken, locationId, n, prefix) {
  var question = getQuestions()[n - 1];
  if (!question) {
    replyText(replyToken, "質問が見つかりません。question シートを確かめてください（setupSheets を実行）。");
    return;
  }

  var items = [];
  question.choices.forEach(function (choice, i) {
    if (choice === "") return;
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: choice.slice(0, 20),
        data: JSON.stringify({ action: "answer", locationId: locationId, question: n, choice: i + 1 }),
        displayText: choice
      }
    });
  });
  replyTextWithQuickReply(replyToken, (prefix ? prefix + "\n" : "") + "問" + n + ". " + question.text, { items: items });
}

function setupSheets() {
  getOrCreateSheet(SHEET_NAMES.LOCATION);
  getOrCreateSheet(SHEET_NAMES.POSTBACK);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_NAMES.QUESTION)) {
    var question = ss.insertSheet(SHEET_NAMES.QUESTION);
    question.appendRow(QUESTION_HEADERS);
    SAMPLE_QUESTIONS.forEach(function (row) { question.appendRow(row); });
    question.setFrozenRows(1);
  }

  var answer = ss.getSheetByName(SHEET_NAMES.ANSWER) || ss.insertSheet(SHEET_NAMES.ANSWER);
  answer.getRange("A1").setFormula(ANSWER_FORMULA);
  answer.getRange("H1").setFormula(ANSWER_ERROR_FORMULA);
  answer.getRange("A2:A").setNumberFormat("yyyy/mm/dd hh:mm");

  var submission = ss.getSheetByName(SHEET_NAMES.SUBMISSION) || ss.insertSheet(SHEET_NAMES.SUBMISSION);
  submission.getRange("A1").setFormula(SUBMISSION_FORMULA);

  console.log("question / answer / submission を準備しました");
}

// ---- 数式（answer と submission はこの数式だけでできる） ----

var ANSWER_FORMULA = '=ARRAYFORMULA(LET(d,FILTER(postback!A2:F,postback!A2:A<>""),n,SEQUENCE(ROWS(d)),js,CHOOSECOLS(d,5),act,IFERROR(REGEXEXTRACT(js,"""action""\\s*:\\s*""([^""]*)"""),""),loc,IFERROR(REGEXEXTRACT(js,"""locationId""\\s*:\\s*""([^""]*)"""),""),q,IFERROR(VALUE(REGEXEXTRACT(js,"""question""\\s*:\\s*(\\d+)")),0),c,IFERROR(VALUE(REGEXEXTRACT(js,"""choice""\\s*:\\s*(\\d+)")),0),txt,MAP(q,c,LAMBDA(x,y,IF(OR(x<1,y<1),"",IFERROR(INDEX(question!B2:F,x,y)&"","")))),ok,(act="answer")*(loc<>"")*(txt<>""),VSTACK({"送信日時","行番号","場所ID","問番号","選択番号","選んだ文字"},IFERROR(SORT(FILTER(HSTACK(CHOOSECOLS(d,1),n,loc,q,c,txt),ok=1),1,TRUE,2,TRUE),{"","","","","",""}))))';

var ANSWER_ERROR_FORMULA = '=ARRAYFORMULA(LET(d,FILTER(postback!A2:F,postback!A2:A<>""),js,CHOOSECOLS(d,5),act,IFERROR(REGEXEXTRACT(js,"""action""\\s*:\\s*""([^""]*)"""),""),loc,IFERROR(REGEXEXTRACT(js,"""locationId""\\s*:\\s*""([^""]*)"""),""),q,IFERROR(VALUE(REGEXEXTRACT(js,"""question""\\s*:\\s*(\\d+)")),0),c,IFERROR(VALUE(REGEXEXTRACT(js,"""choice""\\s*:\\s*(\\d+)")),0),txt,MAP(q,c,LAMBDA(x,y,IF(OR(x<1,y<1),"",IFERROR(INDEX(question!B2:F,x,y)&"","")))),VSTACK("読めなかった行（メッセージID）",IFERROR(FILTER(CHOOSECOLS(d,3),(act="answer")*(((loc="")+(txt=""))>0)),"なし"))))';

var SUBMISSION_FORMULA = '=ARRAYFORMULA(LET(qs,FILTER(question!A2:A,question!A2:A<>""),nq,ROWS(qs),aloc,FILTER(answer!C2:C,answer!C2:C<>""),aq,FILTER(answer!D2:D,answer!C2:C<>""),at,FILTER(answer!F2:F,answer!C2:C<>""),akey,aloc&"|"&aq,lr,FILTER(location!C2:G,location!C2:C<>"",ISNUMBER(MATCH(location!C2:C,aloc,0))),ids,CHOOSECOLS(lr,1),ans,MAKEARRAY(ROWS(ids),nq,LAMBDA(r,k,XLOOKUP(INDEX(ids,r)&"|"&k,akey,at,"無回答",0,-1))),full,HSTACK(lr,ans),done,BYROW(ans,LAMBDA(row,SUM(--(row="無回答"))=0)),IFNA(VSTACK(HSTACK({"場所のID","タイトル","住所","緯度","経度"},TRANSPOSE(qs)),IFERROR(FILTER(full,done),"（全問に答えた場所はまだありません）")),"")))';
