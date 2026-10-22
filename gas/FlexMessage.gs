function buildLocationFlexCarousel(results) {
  var mapUrl = ScriptApp.getService().getUrl() + "?view=map";
  var bubbles = results.map(function (r) {
    return {
      type: "bubble",
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "link", action: { type: "uri", label: "地図で見る", uri: mapUrl + "&id=" + encodeURIComponent(r.locationId) } }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: r.title, weight: "bold", size: "lg", wrap: true },
          { type: "text", text: r.address, size: "sm", color: "#888888", wrap: true },
          { type: "text", text: r.distanceKm.toFixed(2) + " km", size: "sm", margin: "md", color: "#4a86e8", weight: "bold" }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: "近い順に見つかった場所です",
    contents: { type: "carousel", contents: bubbles }
  };
}

/**
 * 登録が終わったときのカード。写真があれば一番上に出す。
 * place.answers は {1: "古い町家", 2: "とても古そう"} の形、questions は getQuestions() の結果。
 */
function buildCompletionCard(place, questions) {
  var answerRows = questions.map(function (q, i) {
    return {
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: q.text, size: "sm", color: "#888888", flex: 4, wrap: true },
        { type: "text", text: place.answers[i + 1] || "-", size: "sm", weight: "bold", flex: 3, wrap: true }
      ]
    };
  });

  var bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: "登録しました！", size: "xs", color: "#4a86e8", weight: "bold" },
        { type: "text", text: place.title, weight: "bold", size: "lg", wrap: true },
        { type: "text", text: place.address, size: "sm", color: "#888888", wrap: true }
      ].concat(answerRows)
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "button", style: "primary", action: { type: "uri", label: "地図で見る", uri: ScriptApp.getService().getUrl() + "?view=map&id=" + encodeURIComponent(place.locationId) } }
      ]
    }
  };

  if (place.photoUrl) {
    bubble.hero = { type: "image", url: place.photoUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }

  return { type: "flex", altText: "登録しました：" + place.title, contents: bubble };
}

function replyFlex(replyToken, flexMessage) {
  reply(replyToken, [flexMessage]);
}
