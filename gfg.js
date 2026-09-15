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
  chrome.runtime.sendMessage({
    type: "SUBMISSION_ACCEPTED",
    payload: {
      platform: "GeeksforGeeks",
      problemNumber: "",
      problemTitle: problemTitle,
      languageExtension: extension,
      code: code
    }
  });

  console.log(`%c[CodeSync] Committed GFG problem: ${problemTitle}.${extension}`, "color: #2da44e; font-weight: bold;");
}