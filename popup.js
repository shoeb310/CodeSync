document.addEventListener("DOMContentLoaded", () => {
  const syncToggle = document.getElementById("syncToggle");
  const toggleCard = document.getElementById("toggleCard");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const ghTokenInput = document.getElementById("ghToken");
  const ghRepoInput = document.getElementById("ghRepo");
  const toggleTokenVis = document.getElementById("toggleTokenVis");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  // History DOM elements
  const historyCard = document.getElementById("historyCard");
  const historyHeader = document.getElementById("historyHeader");
  const historyCount = document.getElementById("historyCount");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");

  // Manual Sync & In-Editor Toggle DOM elements
  const popupManualSyncBtn = document.getElementById("popupManualSyncBtn");
  const manualSyncBtnText = document.getElementById("manualSyncBtnText");
  const manualSyncCard = document.getElementById("manualSyncCard");
  const tabStatusPulse = document.getElementById("tabStatusPulse");
  const tabStatusText = document.getElementById("tabStatusText");
  const inEditorToggle = document.getElementById("inEditorToggle");
  const featuresWrapper = document.getElementById("featuresWrapper");

  let activeTabInfo = null;

  // Update Toggle UI styles and toggle all extension features
  function updateToggleUI(isEnabled) {
    syncToggle.checked = isEnabled;
    if (isEnabled) {
      toggleCard.classList.add("active");
      statusDot.className = "status-dot on";
      statusText.className = "status-text on";
      statusText.innerText = "Active (Syncing)";

      if (featuresWrapper) {
        featuresWrapper.classList.remove("disabled");
      }

      ghTokenInput.disabled = false;
      ghRepoInput.disabled = false;
      toggleTokenVis.disabled = false;
      saveBtn.disabled = false;
      if (inEditorToggle) inEditorToggle.disabled = false;

      historyHeader.setAttribute("tabindex", "0");
      historyHeader.removeAttribute("aria-disabled");

      // Re-evaluate active tab
      checkActiveTab();

      chrome.storage.local.get(["syncHistory"], (data) => {
        const history = Array.isArray(data.syncHistory) ? data.syncHistory : [];
        if (history.length > 0) {
          clearHistoryBtn.disabled = false;
        }
      });
    } else {
      toggleCard.classList.remove("active");
      statusDot.className = "status-dot off";
      statusText.className = "status-text off";
      statusText.innerText = "Disabled (Paused)";

      if (featuresWrapper) {
        featuresWrapper.classList.add("disabled");
      }

      ghTokenInput.disabled = true;
      ghRepoInput.disabled = true;
      toggleTokenVis.disabled = true;
      saveBtn.disabled = true;
      if (inEditorToggle) inEditorToggle.disabled = true;
      popupManualSyncBtn.disabled = true;
      clearHistoryBtn.disabled = true;

      historyHeader.setAttribute("tabindex", "-1");
      historyHeader.setAttribute("aria-disabled", "true");

      setManualSyncUnavailable("Extension is turned off");
    }
  }

  // Load existing configuration from Chrome storage
  chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo", "showInEditorBtn"], (data) => {
    const isEnabled = data.autoSync ?? true; // Defaults to enabled
    updateToggleUI(isEnabled);

    if (data.ghToken) ghTokenInput.value = data.ghToken;
    if (data.ghRepo) ghRepoInput.value = data.ghRepo;
    if (inEditorToggle) inEditorToggle.checked = Boolean(data.showInEditorBtn);
  });

  // In-Editor button toggle handler
  if (inEditorToggle) {
    inEditorToggle.addEventListener("change", () => {
      if (!syncToggle.checked) return;
      const isShown = inEditorToggle.checked;
      chrome.storage.sync.set({ showInEditorBtn: isShown }, () => {
        showStatus(
          isShown ? "In-editor button enabled on problem pages." : "In-editor button hidden.",
          isShown ? "#3fb950" : "#8b949e"
        );
      });
    });
  }

  // Instant toggle on/off switch without needing to click save
  syncToggle.addEventListener("change", () => {
    const isEnabled = syncToggle.checked;
    updateToggleUI(isEnabled);

    chrome.storage.sync.set({ autoSync: isEnabled }, () => {
      showStatus(
        isEnabled ? "Extension enabled." : "Extension paused.",
        isEnabled ? "#3fb950" : "#8b949e"
      );
    });
  });

  // Show/Hide password toggle for PAT
  toggleTokenVis.addEventListener("click", () => {
    if (!syncToggle.checked) return;
    if (ghTokenInput.type === "password") {
      ghTokenInput.type = "text";
      toggleTokenVis.innerText = "Hide";
    } else {
      ghTokenInput.type = "password";
      toggleTokenVis.innerText = "Show";
    }
  });

  // Save changes when clicking the save button
  saveBtn.addEventListener("click", () => {
    if (!syncToggle.checked) return;
    const token = ghTokenInput.value.trim();
    const repo = ghRepoInput.value.trim();
    const isEnabled = syncToggle.checked;

    if (!token || !repo) {
      showStatus("Please fill in both Token and Repo fields.", "#f85149");
      return;
    }

    chrome.storage.sync.set(
      {
        autoSync: isEnabled,
        ghToken: token,
        ghRepo: repo
      },
      () => {
        showStatus("Settings saved successfully!", "#3fb950");
      }
    );
  });

  // --- Active Tab Detection & Manual Push to GitHub ---
  function checkActiveTab() {
    if (!syncToggle.checked) {
      setManualSyncUnavailable("Extension is turned off");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!syncToggle.checked) {
        setManualSyncUnavailable("Extension is turned off");
        return;
      }
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setManualSyncUnavailable("No active tab found");
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "GET_PROBLEM_STATUS" }, (res) => {
        if (!syncToggle.checked) {
          setManualSyncUnavailable("Extension is turned off");
          return;
        }
        if (chrome.runtime.lastError || !res || !res.isProblemPage) {
          setManualSyncUnavailable("No coding problem detected on active tab");
        } else {
          activeTabInfo = {
            tabId: tab.id,
            platform: res.platform,
            problemTitle: res.problemTitle,
            problemNumber: res.problemNumber,
            hasCode: res.hasCode
          };
          setManualSyncAvailable(res);
        }
      });
    });
  }

  function setManualSyncAvailable(info) {
    if (!syncToggle.checked) {
      setManualSyncUnavailable("Extension is turned off");
      return;
    }
    popupManualSyncBtn.disabled = false;
    manualSyncCard.classList.add("ready");
    tabStatusPulse.className = "status-dot on";
    tabStatusText.className = "tab-status-text on";
    const displayTitle = info.problemNumber ? `${info.problemNumber}. ${info.problemTitle}` : info.problemTitle;
    tabStatusText.innerText = `Detected: [${info.platform}] ${displayTitle}`;
    tabStatusText.title = `${info.platform}: ${displayTitle}`;
    manualSyncBtnText.innerText = `Push to GitHub (${info.platform})`;
  }

  function setManualSyncUnavailable(reason) {
    activeTabInfo = null;
    popupManualSyncBtn.disabled = true;
    manualSyncCard.classList.remove("ready");
    tabStatusPulse.className = "status-dot off";
    tabStatusText.className = "tab-status-text";
    tabStatusText.innerText = reason;
    manualSyncBtnText.innerText = (!syncToggle || !syncToggle.checked) ? "Extension Disabled" : "Push Current Problem to GitHub";
  }

  popupManualSyncBtn.addEventListener("click", () => {
    if (!syncToggle.checked || !activeTabInfo || !activeTabInfo.tabId) return;

    popupManualSyncBtn.disabled = true;
    popupManualSyncBtn.className = "manual-push-btn loading";
    manualSyncBtnText.innerText = "Pushing to GitHub...";

    chrome.tabs.sendMessage(activeTabInfo.tabId, { type: "TRIGGER_MANUAL_SYNC" }, (res) => {
      if (chrome.runtime.lastError || (res && res.success === false)) {
        popupManualSyncBtn.className = "manual-push-btn error";
        manualSyncBtnText.innerText = (res && res.error) || "Push Failed";
        setTimeout(() => {
          popupManualSyncBtn.className = "manual-push-btn";
          if (!syncToggle.checked) {
            popupManualSyncBtn.disabled = true;
            manualSyncBtnText.innerText = "Extension Disabled";
          } else if (activeTabInfo) {
            popupManualSyncBtn.disabled = false;
            manualSyncBtnText.innerText = `Push to GitHub (${activeTabInfo.platform})`;
          } else {
            manualSyncBtnText.innerText = "Push Current Problem to GitHub";
          }
        }, 3000);
      } else {
        popupManualSyncBtn.className = "manual-push-btn success";
        manualSyncBtnText.innerText = "✓ Synced to GitHub!";
        showStatus("Solution pushed to GitHub!", "#3fb950");
        setTimeout(() => {
          popupManualSyncBtn.className = "manual-push-btn";
          if (!syncToggle.checked) {
            popupManualSyncBtn.disabled = true;
            manualSyncBtnText.innerText = "Extension Disabled";
          } else if (activeTabInfo) {
            popupManualSyncBtn.disabled = false;
            manualSyncBtnText.innerText = `Push to GitHub (${activeTabInfo.platform})`;
          } else {
            manualSyncBtnText.innerText = "Push Current Problem to GitHub";
          }
        }, 3000);
      }
    });
  });

  // Run tab check immediately on popup open
  checkActiveTab();

  // --- Collapsible History Section ---
  function setHistoryExpanded(expanded) {
    if (expanded) {
      historyCard.classList.add("expanded");
      historyHeader.setAttribute("aria-expanded", "true");
    } else {
      historyCard.classList.remove("expanded");
      historyHeader.setAttribute("aria-expanded", "false");
    }
  }

  // Toggle accordion expand/collapse
  historyHeader.addEventListener("click", (e) => {
    if (!syncToggle.checked) return;
    if (e.target.closest("#clearHistoryBtn")) return;
    const isCurrentlyExpanded = historyCard.classList.contains("expanded");
    const nextState = !isCurrentlyExpanded;
    setHistoryExpanded(nextState);
    chrome.storage.local.set({ historyExpanded: nextState });
  });

  // Clear history button
  clearHistoryBtn.addEventListener("click", (e) => {
    if (!syncToggle.checked) return;
    e.stopPropagation();
    chrome.storage.local.set({ syncHistory: [] }, () => {
      renderHistory([]);
      showStatus("Sync history cleared.", "#8b949e");
    });
  });

  // Load history from local storage
  chrome.storage.local.get(["syncHistory", "historyExpanded"], (localData) => {
    const history = Array.isArray(localData.syncHistory) ? localData.syncHistory : [];
    // Default open if user previously expanded, or if they haven't explicitly closed it and history exists
    const isExpanded = localData.historyExpanded !== undefined ? localData.historyExpanded : (history.length > 0);
    setHistoryExpanded(isExpanded);
    renderHistory(history);
  });

  // Listen for live updates while popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncHistory) {
      renderHistory(changes.syncHistory.newValue || []);
    }
  });

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "";
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 45) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderHistory(items) {
    const list = Array.isArray(items) ? items : [];
    historyCount.innerText = list.length;

    if (list.length === 0) {
      historyEmpty.style.display = "flex";
      historyList.innerHTML = "";
      clearHistoryBtn.style.display = "none";
      return;
    }

    historyEmpty.style.display = "none";
    clearHistoryBtn.style.display = "flex";
    historyList.innerHTML = "";

    list.slice(0, 10).forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "history-item";

      const rawPlatform = (item.platform || "CodeSync").toLowerCase();
      let platformClass = "platform-other";
      if (rawPlatform.includes("leetcode")) platformClass = "leetcode";
      else if (rawPlatform.includes("geeks") || rawPlatform.includes("gfg")) platformClass = "geeksforgeeks";
      else if (rawPlatform.includes("hacker")) platformClass = "hackerrank";
      else if (rawPlatform.includes("chef")) platformClass = "codechef";

      const timeStr = formatRelativeTime(item.timestamp);
      const titleDisplay = item.problemNumber
        ? `${item.problemNumber}. ${item.problemTitle}`
        : item.problemTitle;
      const shaDisplay = item.commitSha ? `#${item.commitSha}` : "Commit";
      const commitUrl = item.commitUrl || "#";

      itemEl.innerHTML = `
        <div class="history-item-top">
          <span class="platform-badge ${platformClass}">${escapeHtml(item.platform || "Sync")}</span>
          <span class="history-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="history-item-title" title="${escapeHtml(titleDisplay)}">${escapeHtml(titleDisplay)}</div>
        <div class="history-item-bottom">
          <a href="${escapeHtml(commitUrl)}" target="_blank" rel="noopener noreferrer" class="commit-link" title="Open commit on GitHub">
            <svg viewBox="0 0 16 16" class="commit-icon"><path d="M10.5 7.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm1.43.75a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 1 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 1 1 0 1.5h-3.32Z"></path></svg>
            <span class="commit-sha">${escapeHtml(shaDisplay)}</span>
            <svg viewBox="0 0 16 16" class="ext-icon"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V4.56l-4.22 4.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l4.22-4.22h-1.69a.75.75 0 0 1-.75-.75Z"></path></svg>
          </a>
          ${item.languageExtension ? `<span class="lang-badge">${escapeHtml(item.languageExtension)}</span>` : ""}
        </div>
      `;

      const linkEl = itemEl.querySelector(".commit-link");
      linkEl.addEventListener("click", (e) => {
        e.preventDefault();
        if (!syncToggle.checked) return;
        if (commitUrl && commitUrl !== "#") {
          chrome.tabs.create({ url: commitUrl });
        }
      });

      historyList.appendChild(itemEl);
    });
  }

  function showStatus(text, color) {
    statusDiv.innerText = text;
    statusDiv.style.color = color;
    setTimeout(() => {
      statusDiv.innerText = "";
    }, 3000);
  }
});