// Listen for messages dispatched by content scripts (e.g., hackerrank.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_ACCEPTED") {
    commitToGitHub(message.payload, sender);
    sendResponse({ received: true });
    return true;
  }
});

function notifyTab(sender, result) {
  if (sender && sender.tab && sender.tab.id) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "COMMIT_RESULT",
      ...result
    }).catch((err) => {
      // Safely ignore: tab was closed, refreshed, or content script not active
      console.debug("[CodeSync] Tab notification skipped:", err.message);
    });
  }
}

async function commitToGitHub(payload, sender) {
  const { platform, problemNumber, problemTitle, languageExtension, code } = payload;
  showBadgeLoading();

  if (!code || !code.trim()) {
    console.warn("[CodeSync] Commit skipped: code body is empty.");
    showBadgeError();
    notifyTab(sender, {
      success: false,
      error: "Commit skipped: empty code body.",
      platform,
      problemTitle
    });
    return;
  }

  const config = await chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo"]);

  if (config.autoSync === false) {
    console.log("[CodeSync] Auto-sync disabled. Skipping commit.");
    return;
  }

  if (!config.ghToken || !config.ghRepo) {
    console.error("[CodeSync] Missing GitHub PAT or target repo.");
    showBadgeError();
    notifyTab(sender, {
      success: false,
      error: "Missing GitHub Token or Repo in CodeSync popup settings.",
      platform,
      problemTitle
    });
    return;
  }

  // Format problem number
  let fileName = "";
  const safeTitle = problemTitle.replace(/[^a-zA-Z0-9_-]/g, "_");

  if (problemNumber && problemNumber.trim()) {
    let formattedNumber = problemNumber.toString().trim();
    if (/^\d+$/.test(formattedNumber)) {
      formattedNumber = formattedNumber.padStart(4, "0");
    }
    fileName = `${formattedNumber}_${safeTitle}.${languageExtension}`;
  } else {
    fileName = `${safeTitle}.${languageExtension}`;
  }

  const filePath = `${platform}/${fileName}`;
  const commitMessage = `Solve [${platform}] ${problemNumber ? problemNumber + ": " : ""}${problemTitle}`;

  const apiUrl = `https://api.github.com/repos/${config.ghRepo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${config.ghToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  try {
    // Check if file exists to acquire SHA
    let fileSha = null;
    const checkRes = await fetch(apiUrl, { headers });

    if (checkRes.ok) {
      const fileData = await checkRes.json();
      fileSha = fileData.sha;
    } else if (checkRes.status !== 404) {
      const errText = await checkRes.text();
      console.error(`[CodeSync] File check error (${checkRes.status}):`, errText);
      showBadgeError();
      notifyTab(sender, {
        success: false,
        error: `GitHub check failed (${checkRes.status})`,
        platform,
        problemTitle
      });
      return;
    }

    const encodedContent = btoa(unescape(encodeURIComponent(code)));

    // Commit file
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: commitMessage,
        content: encodedContent,
        sha: fileSha || undefined
      })
    });

    if (putRes.ok) {
      console.log(`%c[CodeSync] Successfully committed: ${filePath}`, "color: #2da44e; font-weight: bold;");
      showBadgeSuccess();
      notifyTab(sender, {
        success: true,
        platform,
        problemTitle,
        fileName,
        filePath,
        repo: config.ghRepo
      });
    } else {
      const errData = await putRes.json();
      console.error("[CodeSync] GitHub API error:", errData);
      showBadgeError();
      notifyTab(sender, {
        success: false,
        error: errData.message || "GitHub commit failed",
        platform,
        problemTitle
      });
    }
  } catch (err) {
    console.error("[CodeSync] Network error during commit:", err);
    showBadgeError();
    notifyTab(sender, {
      success: false,
      error: "Network error during commit",
      platform,
      problemTitle
    });
  }
}

let badgeTimer = null;

// Shows blue "..." badge while committing to GitHub
function showBadgeLoading() {
  if (badgeTimer) {
    clearInterval(badgeTimer);
    badgeTimer = null;
  }
  chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
  chrome.action.setBadgeText({ text: "..." });
}

// Shows animated green "OK" / "✓" badge for 4 seconds with pulse animation, then clears
function showBadgeSuccess() {
  if (badgeTimer) clearInterval(badgeTimer);

  const frames = [
    { text: "OK", color: "#2da44e" },
    { text: "✓", color: "#3fb950" },
    { text: "OK", color: "#238636" },
    { text: "✓", color: "#2ea043" }
  ];

  let frameIdx = 0;
  const startTime = Date.now();

  const update = () => {
    const frame = frames[frameIdx % frames.length];
    chrome.action.setBadgeBackgroundColor({ color: frame.color });
    chrome.action.setBadgeText({ text: frame.text });
    frameIdx++;
  };

  update();
  badgeTimer = setInterval(() => {
    if (Date.now() - startTime >= 4000) {
      clearInterval(badgeTimer);
      badgeTimer = null;
      chrome.action.setBadgeText({ text: "" });
    } else {
      update();
    }
  }, 400);
}

// Shows animated red "ERR" / "!" badge for 4 seconds, then clears
function showBadgeError() {
  if (badgeTimer) clearInterval(badgeTimer);

  const frames = [
    { text: "ERR", color: "#cf222e" },
    { text: "!", color: "#da3633" },
    { text: "ERR", color: "#b62324" },
    { text: "!", color: "#cf222e" }
  ];

  let frameIdx = 0;
  const startTime = Date.now();

  const update = () => {
    const frame = frames[frameIdx % frames.length];
    chrome.action.setBadgeBackgroundColor({ color: frame.color });
    chrome.action.setBadgeText({ text: frame.text });
    frameIdx++;
  };

  update();
  badgeTimer = setInterval(() => {
    if (Date.now() - startTime >= 4000) {
      clearInterval(badgeTimer);
      badgeTimer = null;
      chrome.action.setBadgeText({ text: "" });
    } else {
      update();
    }
  }, 400);
}