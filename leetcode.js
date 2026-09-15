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
  try {
    chrome.runtime.sendMessage({
      type: "SUBMISSION_ACCEPTED",
      payload: {
        platform: "LeetCode",
        problemNumber: problemNumber,
        problemTitle: problemTitle,
        languageExtension: extension,
        code: code
      }
    });
    console.log(`[CodeSync] Submitted ${problemTitle} as .${extension}`);
  } catch (err) {
    console.warn("[CodeSync] Message delivery failed. Please reload the tab.", err);
  }
}