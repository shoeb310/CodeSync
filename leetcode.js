const EXTENSION_MAP = {
  // Systems & Compiled
  "c++": "cpp",
  "cpp": "cpp",
  "clang": "c",
  "c": "c",
  "c#": "cs",
  "csharp": "cs",
  "rust": "rs",
  "go": "go",
  "golang": "go",

  // JVM Languages
  "java": "java",
  "kotlin": "kt",
  "scala": "scala",

  // Scripting & Web
  "python": "py",
  "python3": "py",
  "py": "py",
  "javascript": "js",
  "js": "js",
  "typescript": "ts",
  "ts": "ts",
  "php": "php",
  "ruby": "rb",

  // Mobile
  "swift": "swift",
  "dart": "dart",

  // Functional & Others
  "racket": "rkt",
  "erlang": "erl",
  "elixir": "ex",

  // Database & Shell
  "mysql": "sql",
  "ms sql server": "sql",
  "oracle": "sql",
  "postgresql": "sql",
  "sql": "sql",
  "pandas": "py",
  "bash": "sh"
};

let isSubmitting = false;

// 1. Listen for clicks on the Submit button
document.addEventListener("click", (e) => {
  const target = e.target.closest("button");
  if (target && target.innerText.trim().toLowerCase().includes("submit")) {
    isSubmitting = true;
    waitForAcceptedVerdict();
  }
});

// 2. Watch DOM for the "Accepted" status
function waitForAcceptedVerdict() {
  const observer = new MutationObserver((mutations, obs) => {
    if (!isSubmitting) return;

    const resultElement = document.querySelector(
      '[data-e2e-locator="submission-result"], [class*="result-text"], span[class*="text-green"]'
    );

    if (resultElement && resultElement.innerText.trim() === "Accepted") {
      isSubmitting = false;
      obs.disconnect(); // Stop observing to prevent duplicate calls

      // Wait 800ms for submission details and code layout to settle
      setTimeout(extractAndDispatchSubmission, 800);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Safety timeout after 30 seconds
  setTimeout(() => {
    observer.disconnect();
    isSubmitting = false;
  }, 30000);
}

// 3. Extract metadata, code, and language
function extractAndDispatchSubmission() {
  // A. Extract Code from Monaco Editor FIRST so it is initialized
  let code = "";
  const codeLines = document.querySelectorAll(".monaco-editor .view-line");
  if (codeLines.length > 0) {
    code = Array.from(codeLines)
      .map((line) => line.textContent)
      .join("\n");
  }

  if (!code.trim()) {
    console.warn("[CodeSync] Could not locate code in editor.");
    return;
  }

  // B. Extract Problem Number & Title
  const titleElement = document.querySelector('div[class*="text-title-large"] a, [data-cy="question-title"]');
  let problemNumber = "0000";
  let problemTitle = "Problem";

  if (titleElement) {
    const rawTitle = titleElement.innerText.trim();
    const splitIndex = rawTitle.indexOf(".");
    if (splitIndex !== -1) {
      problemNumber = rawTitle.slice(0, splitIndex).trim();
      problemTitle = rawTitle.slice(splitIndex + 1).trim();
    } else {
      problemTitle = rawTitle;
    }
  } else {
    const urlMatches = window.location.pathname.match(/\/problems\/([^\/]+)/);
    if (urlMatches && urlMatches[1]) {
      problemTitle = urlMatches[1].replace(/-/g, "_");
    }
  }

  // C. Extract Selected Language (Now safe to test 'code')
  let extension = "txt";

  // Check 1: Button text
  const langSelectors = [
    'button[id*="headlessui-listbox-button"]',
    'button[data-state]',
    'div[class*="rounded"] button'
  ];

  for (const selector of langSelectors) {
    const btn = document.querySelector(selector);
    if (btn) {
      const text = btn.innerText.trim().toLowerCase();
      for (const [langKey, ext] of Object.entries(EXTENSION_MAP)) {
        if (text === langKey || text.startsWith(langKey + " ") || text.endsWith(" " + langKey)) {
          extension = ext;
          break;
        }
      }
      if (extension !== "txt") break;
    }
  }

  // Check 2: Monaco editor mode attribute
  if (extension === "txt") {
    const editor = document.querySelector(".monaco-editor");
    const mode = editor?.getAttribute("data-mode-id");
    if (mode && EXTENSION_MAP[mode.toLowerCase()]) {
      extension = EXTENSION_MAP[mode.toLowerCase()];
    } else {
      // Check 3: Code syntax fallback
      if (/def\s+\w+\(self/i.test(code)) extension = "py";
      else if (/#include/i.test(code)) extension = "cpp";
      else if (/public\s+class/i.test(code)) extension = "java";
      else extension = "cpp";
    }
  }

  // D. Dispatch to background.js safely
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
        platform: "LeetCode",
        problemNumber: problemNumber,
        problemTitle: problemTitle,
        languageExtension: extension,
        code: code
      }
    })
      .then(() => {
        console.log(`[CodeSync] Submitted ${problemTitle} as .${extension}`);
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

// 4. Listen for commit result from background.js and display animated flash pop toast
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