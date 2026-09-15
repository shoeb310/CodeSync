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

  // Update Toggle UI styles
  function updateToggleUI(isEnabled) {
    syncToggle.checked = isEnabled;
    if (isEnabled) {
      toggleCard.classList.add("active");
      statusDot.className = "status-dot on";
      statusText.className = "status-text on";
      statusText.innerText = "Active (Syncing)";
    } else {
      toggleCard.classList.remove("active");
      statusDot.className = "status-dot off";
      statusText.className = "status-text off";
      statusText.innerText = "Disabled (Paused)";
    }
  }

  // Load existing configuration from Chrome storage
  chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo"], (data) => {
    const isEnabled = data.autoSync ?? true; // Defaults to enabled
    updateToggleUI(isEnabled);

    if (data.ghToken) ghTokenInput.value = data.ghToken;
    if (data.ghRepo) ghRepoInput.value = data.ghRepo;
  });

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

  function showStatus(text, color) {
    statusDiv.innerText = text;
    statusDiv.style.color = color;
    setTimeout(() => {
      statusDiv.innerText = "";
    }, 3000);
  }
});