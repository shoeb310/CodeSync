const GFG_LANG_MAP = {
  "cpp": "cpp",
  "c++": "cpp",
  "c": "c",
  "java": "java",
  "python": "py",
  "python3": "py",
  "javascript": "js",
  "csharp": "cs",
  "c#": "cs"
};

let isSubmitting = false;
let lastSyncedProblem = "";

// 1. Listen for the Submit button click
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn && btn.innerText.toLowerCase().includes("submit")) {
    isSubmitting = true;
    waitForGfgVerdict();
  }
});

// 2. Watch for the success banner
function waitForGfgVerdict() {
  const observer = new MutationObserver((mutations, obs) => {
    if (!isSubmitting) return;

    const successModal = document.querySelector(
      '.problems_header_content__right, [class*="problems_content_pane"], div[class*="modal"]'
    );
    const bodyText = document.body.innerText;

    if (
      bodyText.includes("Problem Solved Successfully") ||
      (successModal && successModal.innerText.includes("Correct Answer"))
    ) {
      isSubmitting = false;
      obs.disconnect();

      setTimeout(extractAndDispatchGFG, 1000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    isSubmitting = false;
  }, 30000);
}

// 3. Extract problem metadata, code, and language
function extractAndDispatchGFG() {
  // A. Extract Problem Title & Slug
  const titleEl = document.querySelector(
    '[class*="problem-tab__name"], [class*="g-m-0"], .g-title, h3'
  );
  let problemTitle = "Problem";

  if (titleEl && titleEl.innerText.trim()) {
    problemTitle = titleEl.innerText.trim();
  } else {
    const urlMatch = window.location.pathname.match(/problems\/([^\/]+)/);
    if (urlMatch) problemTitle = urlMatch[1];
  }

  // Deduplicate rapid identical submissions
  if (lastSyncedProblem === problemTitle) return;

  // B. Extract Code FIRST so 'code' exists before any checks
  let code = "";

  // 1. Try Ace Editor
  const aceLines = document.querySelectorAll(".ace_line");
  if (aceLines.length > 0) {
    code = Array.from(aceLines).map((el) => el.textContent).join("\n");
  }

  // 2. Try Monaco Editor
  if (!code.trim()) {
    const monacoLines = document.querySelectorAll(".monaco-editor .view-line");
    if (monacoLines.length > 0) {
      code = Array.from(monacoLines).map((el) => el.textContent).join("\n");
    }
  }

  if (!code.trim()) {
    console.warn("[CodeSync] Could not locate code in GFG editor.");
    return;
  }

  // C. Extract Selected Language (Now safe to inspect 'code')
  let extension = "cpp"; // default fallback

  const langElements = [
    document.querySelector('[class*="select-language"]'),
    document.querySelector('[class*="divider-left"]'),
    document.querySelector('button[aria-haspopup="listbox"]'),
    document.querySelector('[class*="dropdown-toggle"]')
  ];

  for (const el of langElements) {
    if (el) {
      const text = el.innerText.trim().toLowerCase();
      if (text.includes("c++") || text.includes("cpp")) { extension = "cpp"; break; }
      if (text.includes("java")) { extension = "java"; break; }
      if (text.includes("python")) { extension = "py"; break; }
      if (text.includes("c#")) { extension = "cs"; break; }
      if (text.includes("javascript")) { extension = "js"; break; }
      if (text.includes("c") && !text.includes("c++")) { extension = "c"; break; }
    }
  }

  // C++ vs Java syntax fallback
  if (/#include|public\s*:/i.test(code) || /std::/i.test(code) || /vector\s*</i.test(code)) {
    extension = "cpp";
  } else if (/import\s+java/i.test(code) || /public\s+static/i.test(code) || /System\.out/i.test(code)) {
    extension = "java";
  } else if (/def\s+\w+\(self/i.test(code) || /import\s+sys/i.test(code)) {
    extension = "py";
  }

  lastSyncedProblem = problemTitle;

  // D. Dispatch to background.js with empty problemNumber
  showSyncFlashToast({
    state: "loading",
    problemTitle: problemTitle
  });

  chrome.runtime.sendMessage({
    type: "SUBMISSION_ACCEPTED",
    payload: {
      platform: "GeeksforGeeks",
      problemNumber: "",
      problemTitle: problemTitle,
      languageExtension: extension,
      code: code
    }
  })
    .then(() => {
      console.log(`%c[CodeSync] Committed GFG problem: ${problemTitle}.${extension}`, "color: #2da44e; font-weight: bold;");
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