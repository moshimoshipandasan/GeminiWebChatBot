// GASのプロパティサービスからGemini APIキーを取得
// apikeyの取得先 https://aistudio.google.com/app/apikey
const apikey = PropertiesService.getScriptProperties().getProperty('apikey');
const model = 'gemini-2.0-flash'; //高品質
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apikey}`;

// メニュー
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('プロンプト')
    .addItem('プロンプト自動生成', 'generateGeminiPrompt')
    .addToUi();
}

// スプレッドシートの情報
const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEET = SS.getSheetByName('プロンプト');
const SYSTEM_PROMPT = SHEET.getRange(5, 2).getValue();

// ログシートの取得または作成
function getLogSheet() {
  let logSheet = SS.getSheetByName('ログ');
  if (!logSheet) {
    logSheet = SS.insertSheet('ログ');
    // ヘッダーの設定
    logSheet.getRange('A1:E1').setValues([['タイムスタンプ', 'ユーザーID', '役割', 'メッセージ', 'トークン数']]);
    logSheet.setFrozenRows(1);
    // 列幅の設定
    logSheet.setColumnWidth(1, 180); // タイムスタンプ
    logSheet.setColumnWidth(2, 150); // ユーザーID
    logSheet.setColumnWidth(3, 100); // 役割
    logSheet.setColumnWidth(4, 400); // メッセージ
    logSheet.setColumnWidth(5, 100); // トークン数
  }
  return logSheet;
}

// ログを記録する関数
function logChat(userId, role, message) {
  const logSheet = getLogSheet();
  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  // トークン数を概算（簡易的な実装）
  const tokenCount = Math.ceil(message.length / 4);
  
  logSheet.appendRow([
    timestamp,
    userId,
    role,
    message,
    tokenCount
  ]);
}

// キャッシュサービスを初期化
const cache = CacheService.getScriptCache();

// GETリクエストを処理する関数
function doGet(request) {
  // キャッシュをクリア
  cache.remove("conversationHistory");
  // 'index'ファイルからHTMLテンプレートを作成
  const template = HtmlService.createTemplateFromFile('index');
  // テンプレートを評価してHTML出力を生成
  const output = template.evaluate();
  // HTMLをiframe内に埋め込むことを許可
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // HTML出力を返す
  return output;
}

// メッセージを処理する関数
function processMessage(userId, message) {
  let conversationHistory = JSON.parse(cache.get("conversationHistory") || "{}");
  
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  // ユーザーメッセージを履歴に追加
  conversationHistory[userId].push({ role: "user", parts: [{ text: message }] });
  // ユーザーメッセージをログに記録
  logChat(userId, "user", message);

  // 履歴を最新の5メッセージに制限
  if (conversationHistory[userId].length > 10) {
    conversationHistory[userId] = conversationHistory[userId].slice(-10);
  }

  // Gemini APIにリクエストを送信
  const response = callGeminiAPI(userId, conversationHistory[userId]);

  // AIの応答を履歴に追加
  conversationHistory[userId].push({ role: "model", parts: [{ text: response }] });
  // AIの応答をログに記録
  logChat(userId, "model", response);

  // 更新された履歴をキャッシュに保存
  cache.put("conversationHistory", JSON.stringify(conversationHistory), 21600); // 6時間キャッシュ

  return response;
}

// Gemini APIを呼び出す関数
function callGeminiAPI(userId, history) {
  const payload = {
    systemInstruction: {
      role: "model",
      parts:[{text: SYSTEM_PROMPT}]
    },
    contents: history,
    generationConfig: {
      temperature: 0.3,
      top_p: 0.9,
      top_k: 40,
      max_output_tokens: 8192
    }
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(GEMINI_URL, options);
    const responseJson = JSON.parse(response.getContentText());
    if (responseJson && responseJson.candidates && responseJson.candidates.length > 0) {
      return responseJson.candidates[0].content.parts[0].text;
    } else {
      return 'No response from Gemini API';
    }
  } catch (e) {
    console.error('Error calling Gemini API:', e);
    return 'Error retrieving response: ' + e.toString();
  }
}

function generateGeminiPrompt() {
  const values = [SHEET.getRange('B2').getValue(), SHEET.getRange('B3').getValue(), SHEET.getRange('B4').getValue()];
  const baseText = `# タスクの説明：${values.join('、')} + "\n
## 役割・目標
あなたは、Gemini AIモデル用の効果的なプロンプトを自動生成するAIアシスタントです。目標は、ユーザーが指定したタスクに対して最適化された、明確で構造化されたプロンプトを作成することです。

## 視点・対象
- 主な対象：Gemini AIモデルを使用するユーザー
- 二次的な対象：Gemini AIモデル自体（プロンプトの受け手として）

## 制約条件
1. 生成されるプロンプトは、Gemini AIモデルの特性と制限を考慮に入れたものであること
2. プロンプトは明確で簡潔であること、ただし必要な詳細は省略しないこと
3. 特定の構造（役割・目標、制約条件など）を含めること
4. 倫理的で法的に問題のない内容であること
5. Geminiの機能と制限を正確に反映すること

## 処理手順 (Chain of Thought)
1. ユーザーの入力を分析し、要求されているタスクを特定する
2. タスクに適した役割と目標を定義する
3. 対象となる視点や読者を決定する
4. タスクに関連する制約条件をリストアップする
5. タスクを完了するための具体的な手順を考案する
6. 必要な入力情報を特定する
7. 期待される出力形式を決定する
8. 上記の要素を組み合わせて、構造化されたプロンプトを作成する
9. プロンプトを見直し、明確さと簡潔さを確認する
10. 必要に応じて微調整を行う

## 入力文
以下の形式で入力を受け付けます：

[タスクの説明]のGemini用プロンプトを役割・目標、視点・対象、制約条件、処理手順(CoT)、入力文、出力文を考慮して作成して

## 出力文
以下の構造に従ってプロンプトを生成します：

# [タスク名] Gemini Prompt

## 役割・目標
[役割と目標の説明]

## 視点・対象
[視点と対象の列挙]

## 制約条件
1. [制約条件1]
2. [制約条件2]
...

## 処理手順 (Chain of Thought)
1. [手順1]
2. [手順2]
...

## 入力文
[必要な入力情報の説明]

## 出力文
[期待される出力形式の説明]

このフォーマットに従って、要求されたタスクに最適化されたGemini用プロンプトを生成します。
`;

  const payload = {
    'contents': [{
      'parts': [{
        'text': baseText
      }]
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(GEMINI_URL, options);
    const responseJson = JSON.parse(response.getContentText());
    
    if (responseJson && responseJson.candidates && responseJson.candidates.length > 0) {
      const generatedPrompt = responseJson.candidates[0].content.parts[0].text;
      SHEET.getRange('B5').setValue(generatedPrompt);
      // プロンプト生成のログを記録
      // logChat('SYSTEM', 'prompt_generation', generatedPrompt);
      return generatedPrompt;
    } else {
      const errorMessage = 'No response from Gemini API';
      // SHEET.getRange('B5').setValue(errorMessage);
      return errorMessage;
    }
  } catch (e) {
    const errorMessage = 'Error retrieving response: ' + e.toString();
    // SHEET.getRange('B5').setValue(errorMessage);
    return errorMessage;
  }
}