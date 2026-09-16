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
  const config = await chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo"]);
  const { platform, problemNumber, problemTitle, languageExtension, code } = payload;

  if (config.autoSync === false) {
    console.log("[CodeSync] Auto-sync disabled. Skipping commit.");
    notifyTab(sender, {
      success: false,
      error: "CodeSync auto-sync is turned off.",
      platform,
      problemTitle
    });
    return;
  }

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
      const resData = await putRes.json().catch(() => null);
      const commitSha = resData?.commit?.sha || "";
      const commitUrl =
        resData?.commit?.html_url ||
        (commitSha ? `https://github.com/${config.ghRepo}/commit/${commitSha}` : `https://github.com/${config.ghRepo}`);

      console.log(`%c[CodeSync] Successfully committed: ${filePath}`, "color: #2da44e; font-weight: bold;");
      showBadgeSuccess();

      await recordSyncHistory({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        platform,
        problemNumber: problemNumber ? problemNumber.toString().trim() : "",
        problemTitle,
        languageExtension: languageExtension || "",
        commitUrl,
        commitSha: commitSha ? commitSha.substring(0, 7) : "",
        timestamp: Date.now()
      });

      notifyTab(sender, {
        success: true,
        platform,
        problemTitle,
        fileName,
        filePath,
        repo: config.ghRepo,
        commitUrl
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

// Stores the last 10 synced problems in chrome.storage.local
async function recordSyncHistory(entry) {
  try {
    const data = await chrome.storage.local.get(["syncHistory"]);
    const current = Array.isArray(data.syncHistory) ? data.syncHistory : [];
    // Avoid exact duplicate commits if retried, otherwise prepend newest
    const filtered = current.filter(
      (item) => item.commitSha !== entry.commitSha || !entry.commitSha
    );
    const updated = [entry, ...filtered].slice(0, 10);
    await chrome.storage.local.set({ syncHistory: updated });
  } catch (err) {
    console.error("[CodeSync] Failed to save sync history:", err);
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
      restoreDefaultBadge();
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
      restoreDefaultBadge();
    } else {
      update();
    }
  }, 400);
}

// Restores default badge: "OFF" if autoSync is disabled, or blank if enabled
function restoreDefaultBadge() {
  chrome.storage.sync.get(["autoSync"], (data) => {
    if (data.autoSync === false) {
      chrome.action.setBadgeBackgroundColor({ color: "#6e7681" });
      chrome.action.setBadgeText({ text: "OFF" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  });
}

// Sync initial badge state on startup
restoreDefaultBadge();

// Listen for toggle changes from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.autoSync !== undefined) {
    if (badgeTimer) {
      clearInterval(badgeTimer);
      badgeTimer = null;
    }
    restoreDefaultBadge();
  }
});