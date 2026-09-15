// CodeChef Content Script (CodeSync)
// Runs in the extension's ISOLATED world. Communicates with codechef-bridge.js (MAIN world)
// to reliably obtain the complete code and dispatch to background.js for GitHub commit.

const CC_LANG_MAP = {
  "c++": "cpp",
  "c++14": "cpp",
  "c++17": "cpp",
  "c++20": "cpp",
  "cpp": "cpp",
  "cpp14": "cpp",
  "cpp17": "cpp",
  "cpp20": "cpp",
  "c": "c",
  "java": "java",
  "java 8": "java",
  "java 11": "java",
  "java 17": "java",
  "python": "py",
  "python 3": "py",
  "python3": "py",
  "pyth 3": "py",
  "py3": "py",
  "pypy": "py",
  "pypy 3": "py",
  "pypy3": "py",
  "javascript": "js",
  "node": "js",
  "nodejs": "js",
  "typescript": "ts",
  "c#": "cs",
  "csharp": "cs",
  "ruby": "rb",
  "go": "go",
  "golang": "go",
  "rust": "rs",
  "kotlin": "kt",
  "scala": "scala",
  "swift": "swift",
  "php": "php"
};

let cachedCode = "";
let cachedLang = "cpp";
let hasCommitted = false;
let isObserving = false;
let lastSyncedCode = "";

function normalizeLanguage(rawLang) {
  if (!rawLang) return "";
  const cleaned = rawLang.trim().toLowerCase();
  if (CC_LANG_MAP[cleaned]) return CC_LANG_MAP[cleaned];
  for (const [key, ext] of Object.entries(CC_LANG_MAP)) {
    if (cleaned.includes(key)) return ext;
  }
  return "";
}

// 1. Listen for complete code broadcasted from codechef-bridge.js (MAIN world)
window.addEventListener("CodeSync_CodeChef_Data", (e) => {
  if (e.detail && e.detail.code && e.detail.code.trim()) {
    cachedCode = e.detail.code;
    const normalized = normalizeLanguage(e.detail.language);
    if (normalized) cachedLang = normalized;
    console.debug(`[CodeSync CodeChef] Received code from bridge (${cachedCode.split('\n').length} lines, lang: ${cachedLang})`);
  }
});

function requestCodeFromBridge() {
  window.dispatchEvent(new CustomEvent("CodeSync_Request_CodeChef_Code"));
}

// 2. Listen for clicks on Submit button
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button, a, input[type='submit']");
  if (!btn) return;
  const text = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();

  if (text === "submit" || text.includes("submit code") || text === "submit solution") {
    hasCommitted = false;
    requestCodeFromBridge();
    detectLanguageFromUI();
    waitForAcceptedVerdict();
  }
}, true);

// Listen for keyboard shortcut Ctrl+Enter / Cmd+Enter
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    hasCommitted = false;
    requestCodeFromBridge();
    detectLanguageFromUI();
    waitForAcceptedVerdict();
  }
}, true);

// 3. Detect language from UI selectors
function detectLanguageFromUI() {
  const langSelectors = [
    '[class*="select-language"]',
    '[class*="language-select"]',
    'button[id*="headlessui-listbox-button"]',
    '[class*="Select-value-label"]',
    '[class*="singleValue"]',
    '.css-1uccc91-singleValue'
  ];

  for (const sel of langSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      const norm = normalizeLanguage(text);
      if (norm) {
        cachedLang = norm;
        break;
      }
    }
  }
}

// Fallback extraction if bridge didn't supply code
function fallbackExtractCode() {
  // Monaco lines
  const monacoLines = document.querySelectorAll(".monaco-editor .view-line");
  if (monacoLines.length > 0) {
    const joined = Array.from(monacoLines).map((el) => el.textContent).join("\n");
    if (joined.trim().length > cachedCode.length) cachedCode = joined;
  }

  // Ace lines
  const aceLines = document.querySelectorAll(".ace_line");
  if (aceLines.length > 0) {
    const joined = Array.from(aceLines).map((el) => el.textContent).join("\n");
    if (joined.trim().length > cachedCode.length) cachedCode = joined;
  }

  // Textarea
  if (!cachedCode.trim()) {
    const textareas = document.querySelectorAll("textarea.inputarea, .monaco-editor textarea, textarea");
    for (const ta of textareas) {
      if (ta.value && ta.value.trim().length > 0) {
        cachedCode = ta.value;
        break;
      }
    }
  }
}

// Syntax heuristics if language is still default
function refineLanguageBySyntax() {
  if (!cachedCode) return;
  if (/def\s+\w+\s*\(|print\(.*?\)|import\s+sys/i.test(cachedCode) && !/#include/i.test(cachedCode)) {
    cachedLang = "py";
  } else if (/#include|std::|cin\s*>>|cout\s*<</i.test(cachedCode)) {
    cachedLang = "cpp";
  } else if (/public\s+class|System\.out\.println/i.test(cachedCode)) {
    cachedLang = "java";
  } else if (/package\s+main|func\s+main/i.test(cachedCode)) {
    cachedLang = "go";
  } else if (/fn\s+main/i.test(cachedCode)) {
    cachedLang = "rs";
  }
}

// 4. Watch for successful submission verdict
function waitForAcceptedVerdict() {
  if (isObserving) return;
  isObserving = true;

  let pollTimer = null;
  let attempts = 0;
  const maxAttempts = 60; // 30 seconds

  const checkStatus = (observer) => {
    if (hasCommitted) {
      cleanup(observer);
      return;
    }

    const bodyText = document.body ? (document.body.innerText || "") : "";

    // Look for submission result container or modal
    const modalEl = document.querySelector(
      '[class*="submission-result"], [class*="submission__result"], [class*="SubmissionResult"], [class*="ResultModal"], [class*="status-container"], [class*="submission-status"], .modal-content, [role="dialog"], [class*="verdict"]'
    );
    const modalText = modalEl ? (modalEl.innerText || "") : "";

    // Specific success elements on CodeChef (scoped to modal/verdict when available)
    const successElement =
      (modalEl && modalEl.querySelector(
        '[class*="correct-answer"], [class*="status--accepted"], [class*="verdict-accepted"], [class*="status-accepted"], [class*="tick-icon"], [class*="tick"], [class*="badge--accepted"]'
      )) ||
      document.querySelector('[class*="verdict-accepted"], [class*="status--accepted"], [class*="correct-answer"]');

    // Negative indicators: if still evaluating or failed, do not commit
    const isProcessing =
      bodyText.includes("Running...") ||
      bodyText.includes("Judging...") ||
      bodyText.includes("Evaluating...") ||
      bodyText.includes("In Queue") ||
      bodyText.includes("Compiling...");

    const hasFailed =
      bodyText.includes("Wrong Answer") ||
      bodyText.includes("Partially Solved") ||
      bodyText.includes("Time Limit Exceeded") ||
      bodyText.includes("Runtime Error") ||
      bodyText.includes("Compilation Error");

    const isSuccess =
      !isProcessing &&
      (
        Boolean(successElement) ||
        modalText.includes("Correct Answer") ||
        modalText.includes("Score: 100") ||
        modalText.includes("Score 100") ||
        modalText.includes("100/100") ||
        bodyText.includes("Correct Answer") ||
        bodyText.includes("Score: 100") ||
        bodyText.includes("Score 100") ||
        bodyText.includes("100 pts") ||
        bodyText.includes("Accepted (100%)") ||
        (bodyText.includes("AC") && !hasFailed && bodyText.includes("Submission Result"))
      );

    if (isSuccess && !hasCommitted) {
      hasCommitted = true;
      cleanup(observer);

      requestCodeFromBridge();
      setTimeout(() => {
        dispatchCommit();
      }, 700);
    }
  };

  const cleanup = (observer) => {
    isObserving = false;
    if (observer) observer.disconnect();
    if (pollTimer) clearInterval(pollTimer);
  };

  const observer = new MutationObserver(() => {
    checkStatus(observer);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  pollTimer = setInterval(() => {
    attempts++;
    checkStatus(observer);
    if (attempts >= maxAttempts) {
      cleanup(observer);
    }
  }, 500);
}

// 5. Dispatch payload to background.js
function dispatchCommit() {
  if (!cachedCode || !cachedCode.trim()) {
    fallbackExtractCode();
  }

  if (!cachedCode || !cachedCode.trim()) {
    console.warn("[CodeSync] Aborted commit: No code captured in editor.");
    return;
  }

  refineLanguageBySyntax();

  // Extract problem code and title
  let problemCode = "";
  let problemTitle = "Challenge";

  const urlMatches =
    window.location.pathname.match(/problems\/([^\/?#]+)/) ||
    window.location.pathname.match(/submit\/([^\/?#]+)/);

  if (urlMatches && urlMatches[1]) {
    problemCode = urlMatches[1].trim();
    problemTitle = problemCode;
  }

  const titleEl = document.querySelector(
    "[class*='ProblemTitle'], [class*='problem-title'], [class*='problemName'], [data-testid='problem-title'], h1, .title"
  );
  if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
    let rawTitle = titleEl.innerText.trim().split("\n")[0].trim();
    rawTitle = rawTitle.replace(/\(Problem Code:.*?\)/gi, "").trim();
    if (rawTitle && !rawTitle.toLowerCase().includes("submit") && rawTitle.length < 100) {
      problemTitle = rawTitle;
    }
  }

  // Avoid redundant FLOW001_FLOW001 if problemTitle is already the problemCode
  const pNumber = (problemCode && problemTitle.toLowerCase() === problemCode.toLowerCase())
    ? ""
    : problemCode;

  // Avoid rapid duplicate syncs
  if (lastSyncedCode === (problemCode || problemTitle)) {
    const elapsed = Date.now() - (dispatchCommit.lastTime || 0);
    if (elapsed < 5000) return;
  }
  lastSyncedCode = problemCode || problemTitle;
  dispatchCommit.lastTime = Date.now();

  // Check if extension is enabled via popup toggle
  chrome.storage.sync.get(["autoSync"], (data) => {
    if (data.autoSync === false) {
      console.log("[CodeSync] Auto-sync is currently paused via popup toggle. Skipping commit.");
      return;
    }

    showSyncFlashToast({
      state: "loading",
      problemTitle: problemTitle
    });

    chrome.runtime.sendMessage({
      type: "SUBMISSION_ACCEPTED",
      payload: {
        platform: "CodeChef",
        problemNumber: pNumber,
        problemTitle: problemTitle,
        languageExtension: cachedLang,
        code: cachedCode
      }
    })
      .then(() => {
        const lineCount = cachedCode.split("\n").length;
        console.log(
          `%c[CodeSync] Successfully dispatched CodeChef: ${problemTitle}.${cachedLang} (${lineCount} lines, ${cachedCode.length} chars)`,
          "color: #2da44e; font-weight: bold;"
        );
      })
      .catch((err) => {
        console.warn("[CodeSync] Message delivery failed. Please reload the tab.", err);
        showSyncFlashToast({
          state: "error",
          error: "Extension communication failed. Please reload the tab.",
          problemTitle: problemTitle
        });
      });
  });
}

// 6. Listen for commit result from background.js and display animated flash pop toast
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "COMMIT_RESULT") {
    showSyncFlashToast(message);
  }
});

let codesyncToastTimer = null;

function showSyncFlashToast(result) {
  const isLoading = result.state === "loading";
  const isSuccess = !isLoading && Boolean(result.success);
  const isError = !isLoading && !isSuccess;

  if (codesyncToastTimer) {
    clearTimeout(codesyncToastTimer);
    codesyncToastTimer = null;
  }

  let badgeBg, borderColor, glowColor, titleText, descHtml, badgeIcon, progressStyle;

  if (isLoading) {
    badgeBg = "linear-gradient(135deg, #1f6feb, #388bfd)";
    borderColor = "rgba(56, 139, 253, 0.7)";
    glowColor = "rgba(56, 139, 253, 0.4)";
    titleText = "CodeSync • Git committing...";
    descHtml = `Committing <b>${result.problemTitle || "Solution"}</b> to GitHub...`;
    badgeIcon = `<div class="codesync-spinner"></div>`;
    progressStyle = "background: #388bfd; animation: codesync-pulse 1s infinite;";
  } else if (isSuccess) {
    badgeBg = "linear-gradient(135deg, #238636, #2ea043)";
    borderColor = "rgba(46, 160, 67, 0.8)";
    glowColor = "rgba(46, 160, 67, 0.45)";
    titleText = "CodeSync • Committed successfully!";
    descHtml = `Pushed <b>${result.problemTitle || "Solution"}</b> to <code>${result.repo || "GitHub"}/${result.filePath || result.fileName}</code>`;
    badgeIcon = `<svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
    progressStyle = "background: #2ea043; animation: codesync-progress-drain 4s linear forwards;";
  } else {
    badgeBg = "linear-gradient(135deg, #da3633, #f85149)";
    borderColor = "rgba(248, 81, 73, 0.8)";
    glowColor = "rgba(248, 81, 73, 0.45)";
    titleText = "CodeSync • Commit failed";
    descHtml = result.error || "Could not push to GitHub. Please verify your token and repo in CodeSync settings.";
    badgeIcon = `<svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4Zm.75 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`;
    progressStyle = "background: #f85149; animation: codesync-progress-drain 4s linear forwards;";
  }

  let toast = document.getElementById("codesync-toast-root");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "codesync-toast-root";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <style>
      #codesync-toast-root {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        pointer-events: auto;
      }
      .codesync-card {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: linear-gradient(135deg, rgba(13, 17, 23, 0.96) 0%, rgba(22, 27, 34, 0.96) 100%);
        color: #e6edf3;
        border: 1px solid ${borderColor};
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 24px ${glowColor};
        border-radius: 12px;
        padding: 16px 18px 14px 18px;
        width: 370px;
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(12px);
        transition: border-color 0.3s ease, box-shadow 0.3s ease;
        animation: codesync-slide-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .codesync-card.codesync-closing {
        animation: codesync-slide-out 0.4s cubic-bezier(0.7, 0, 0.84, 0) forwards;
      }
      @keyframes codesync-slide-in {
        0% { transform: translateY(-40px) scale(0.92); opacity: 0; }
        70% { transform: translateY(6px) scale(1.02); opacity: 1; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes codesync-slide-out {
        0% { transform: translateY(0) scale(1); opacity: 1; }
        100% { transform: translateY(-30px) scale(0.9); opacity: 0; }
      }
      .codesync-badge {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${badgeBg};
        box-shadow: 0 0 12px ${glowColor};
        transition: background 0.3s ease;
      }
      .codesync-badge svg {
        width: 20px;
        height: 20px;
        fill: #ffffff;
      }
      .codesync-spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: codesync-spin 0.75s linear infinite;
      }
      @keyframes codesync-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes codesync-pulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.05); opacity: 1; }
        100% { transform: scale(1); opacity: 0.8; }
      }
      .codesync-content {
        flex: 1;
        min-width: 0;
      }
      .codesync-title {
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        margin: 0 0 4px 0;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .codesync-desc {
        font-size: 12px;
        color: #8b949e;
        line-height: 1.45;
        margin: 0;
        word-break: break-word;
      }
      .codesync-desc b {
        color: #e6edf3;
      }
      .codesync-desc code {
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
        font-size: 11px;
        color: ${isSuccess ? "#3fb950" : (isLoading ? "#58a6ff" : "#f85149")};
        background: rgba(110, 118, 129, 0.15);
        padding: 2px 4px;
        border-radius: 4px;
        display: inline-block;
        margin-top: 2px;
      }
      .codesync-close {
        flex-shrink: 0;
        background: none;
        border: none;
        color: #8b949e;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        margin-left: 4px;
      }
      .codesync-close:hover {
        color: #ffffff;
      }
      .codesync-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        width: 100%;
        ${progressStyle}
      }
      @keyframes codesync-progress-drain {
        from { width: 100%; }
        to { width: 0%; }
      }
    </style>
    <div class="codesync-card">
      <div class="codesync-badge">
        ${badgeIcon}
      </div>
      <div class="codesync-content">
        <div class="codesync-title">${titleText}</div>
        <p class="codesync-desc">${descHtml}</p>
      </div>
      <button class="codesync-close" aria-label="Close">&times;</button>
      <div class="codesync-progress"></div>
    </div>
  `;

  const card = toast.querySelector(".codesync-card");
  const closeBtn = toast.querySelector(".codesync-close");

  const dismiss = () => {
    if (card && !card.classList.contains("codesync-closing")) {
      card.classList.add("codesync-closing");
      setTimeout(() => {
        toast.remove();
      }, 400);
    }
  };

  closeBtn.addEventListener("click", dismiss);

  if (!isLoading) {
    codesyncToastTimer = setTimeout(dismiss, 4000);
  }
}
