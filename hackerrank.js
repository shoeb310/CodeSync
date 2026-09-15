// HackerRank Content Script (CodeSync)
// Runs in the extension's ISOLATED world. Communicates with hackerrank-bridge.js (MAIN world)
// to reliably obtain the complete code and dispatch to background.js for GitHub commit.

const HR_LANG_MAP = {
  "c++": "cpp",
  "cpp": "cpp",
  "cpp14": "cpp",
  "cpp20": "cpp",
  "c++14": "cpp",
  "c++20": "cpp",
  "c": "c",
  "java": "java",
  "java 8": "java",
  "java 15": "java",
  "java8": "java",
  "java15": "java",
  "python": "py",
  "python 3": "py",
  "python3": "py",
  "python2": "py",
  "pypy": "py",
  "pypy 3": "py",
  "pypy3": "py",
  "javascript": "js",
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
  "php": "php",
  "r": "r",
  "perl": "pl",
  "sql": "sql",
  "mysql": "sql",
  "oracle": "sql",
  "bash": "sh"
};

let cachedCode = "";
let cachedLang = "cpp";
let hasCommitted = false;
let isObserving = false;
let lastSyncedTitle = "";

function normalizeLanguage(rawLang) {
  if (!rawLang) return "";
  const cleaned = rawLang.trim().toLowerCase();
  if (HR_LANG_MAP[cleaned]) return HR_LANG_MAP[cleaned];
  for (const [key, ext] of Object.entries(HR_LANG_MAP)) {
    if (cleaned.includes(key)) return ext;
  }
  return "";
}

// 1. Listen for complete code broadcasted from hackerrank-bridge.js (MAIN world)
window.addEventListener("CodeSync_HackerRank_Data", (e) => {
  if (e.detail && e.detail.code && e.detail.code.trim()) {
    cachedCode = e.detail.code;
    const normalized = normalizeLanguage(e.detail.language);
    if (normalized) cachedLang = normalized;
    console.debug(`[CodeSync] Captured code from bridge (${cachedCode.split('\n').length} lines, lang: ${cachedLang}, source: ${e.detail.source || 'unknown'})`);
  }
});

// Request code extraction from the bridge
function requestCodeFromBridge() {
  window.dispatchEvent(new CustomEvent("CodeSync_Request_HackerRank_Code"));
}

// 2. Listen for clicks on Submit Code button
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const label = (btn.innerText || btn.textContent || "").trim().toLowerCase();

  if (label.includes("submit code") || label === "submit") {
    hasCommitted = false;
    requestCodeFromBridge();
    detectLanguageFromUI();
    waitForAcceptedVerdict();
  }
}, true); // Capture phase to run before HackerRank modifies/disables elements

// Also listen for shortcut keys like Ctrl+Enter / Cmd+Enter which submit code
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    requestCodeFromBridge();
    detectLanguageFromUI();
    waitForAcceptedVerdict();
  }
}, true);

// 3. Detect language from UI dropdown
function detectLanguageFromUI() {
  const langContainer = document.querySelector(
    '[class*="select-language"], [data-analytics="SelectLanguage"], .css-1uccc91-singleValue, .css-1hwfws3, [class*="select__single-value"]'
  );
  if (langContainer) {
    const text = (langContainer.innerText || langContainer.textContent || "").trim().toLowerCase();
    const normalized = normalizeLanguage(text);
    if (normalized) {
      cachedLang = normalized;
    }
  }
}

// Fallback extraction if bridge didn't supply code
function fallbackExtractCode() {
  // Method 1: Monaco view lines (all available rendered lines)
  const monacoLines = document.querySelectorAll(".monaco-editor .view-line");
  if (monacoLines.length > 0) {
    const joined = Array.from(monacoLines)
      .map((el) => el.textContent)
      .join("\n");
    if (joined.trim().length > cachedCode.length) {
      cachedCode = joined;
    }
  }

  // Method 2: Ace editor lines
  const aceLines = document.querySelectorAll(".ace_line");
  if (aceLines.length > 0) {
    const joined = Array.from(aceLines)
      .map((el) => el.textContent)
      .join("\n");
    if (joined.trim().length > cachedCode.length) {
      cachedCode = joined;
    }
  }

  // Method 3: Textareas
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

    // Specific success elements
    const successElement = document.querySelector(
      '.congrats-heading, [data-analytics="SubmissionSuccess"], .submission-status-success, .challenge-response-success, .view-results-banner'
    );

    // Negative indicators: if still running or failed, do not trigger
    const isProcessing = bodyText.includes("Processing...") || bodyText.includes("Compiling...") || bodyText.includes("Running tests...");
    const hasFailed = bodyText.includes("Wrong Answer") || bodyText.includes("Compilation error") || bodyText.includes("Runtime Error");

    const isSuccess =
      !isProcessing &&
      (
        Boolean(successElement) ||
        bodyText.includes("Congratulations!") ||
        (bodyText.includes("Test Cases Passed") && !hasFailed) ||
        bodyText.includes("All test cases passed") ||
        bodyText.includes("Score: 100") ||
        bodyText.includes("You have earned")
      );

    if (isSuccess && !hasCommitted) {
      hasCommitted = true;
      cleanup(observer);

      // Refresh code one final time from bridge before dispatching
      requestCodeFromBridge();
      setTimeout(() => {
        dispatchCommit();
      }, 600);
    }
  };

  const cleanup = (observer) => {
    isObserving = false;
    if (observer) observer.disconnect();
    if (pollTimer) clearInterval(pollTimer);
  };

  // MutationObserver for instant trigger
  const observer = new MutationObserver(() => {
    checkStatus(observer);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Polling fallback
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
  // If bridge didn't yield code yet, try DOM fallback
  if (!cachedCode || !cachedCode.trim()) {
    fallbackExtractCode();
  }

  if (!cachedCode || !cachedCode.trim()) {
    console.warn("[CodeSync] Aborted commit: No code captured in editor.");
    return;
  }

  refineLanguageBySyntax();

  // Extract challenge title
  let problemTitle = "Challenge";
  const titleEl = document.querySelector(
    "[data-automation='challenge-name'], .ui-icon-label, h1.ui-heading, .challenge-title, h1"
  );
  if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
    problemTitle = titleEl.innerText.trim();
  } else {
    const match = window.location.pathname.match(/challenges\/([^/?#]+)/);
    if (match && match[1]) {
      problemTitle = match[1].replace(/-/g, " ");
      problemTitle = problemTitle.replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  // Avoid rapid duplicate commits for the exact same problem
  if (lastSyncedTitle === problemTitle) {
    const elapsed = Date.now() - (dispatchCommit.lastTime || 0);
    if (elapsed < 5000) {
      return;
    }
  }
  lastSyncedTitle = problemTitle;
  dispatchCommit.lastTime = Date.now();

  // Show immediate "Git committing..." loading pop-up message
  showSyncFlashToast({
    state: "loading",
    problemTitle: problemTitle
  });

  chrome.runtime.sendMessage({
    type: "SUBMISSION_ACCEPTED",
    payload: {
      platform: "HackerRank",
      problemNumber: "",
      problemTitle: problemTitle,
      languageExtension: cachedLang,
      code: cachedCode
    }
  })
    .then(() => {
      const lineCount = cachedCode.split("\n").length;
      console.log(
        `%c[CodeSync] Successfully dispatched HackerRank: ${problemTitle}.${cachedLang} (${lineCount} lines, ${cachedCode.length} chars)`,
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

  // For success or error, auto-dismiss in 4 seconds
  if (!isLoading) {
    codesyncToastTimer = setTimeout(dismiss, 4000);
  }
}

