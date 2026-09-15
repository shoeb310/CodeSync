document.addEventListener("DOMContentLoaded", () => {
  const syncToggle = document.getElementById("syncToggle");
  const ghTokenInput = document.getElementById("ghToken");
  const ghRepoInput = document.getElementById("ghRepo");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  // Load existing configuration from Chrome storage
  chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo"], (data) => {
    syncToggle.checked = data.autoSync ?? true; // Defaults to enabled
    if (data.ghToken) ghTokenInput.value = data.ghToken;
    if (data.ghRepo) ghRepoInput.value = data.ghRepo;
  });

  // Save changes when clicking the save button
  saveBtn.addEventListener("click", () => {
    const token = ghTokenInput.value.trim();
    const repo = ghRepoInput.value.trim();
    const isEnabled = syncToggle.checked;

    if (!token || !repo) {
      showStatus("Please fill in both fields.", "#cf222e");
      return;
    }

    chrome.storage.sync.set(
      {
        autoSync: isEnabled,
        ghToken: token,
        ghRepo: repo
      },
      () => {
        showStatus("Settings saved successfully!", "#1a7f37");
      }
    );
  });

  // Quick toggle without needing to press save
  syncToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoSync: syncToggle.checked });
  });

  function showStatus(text, color) {
    statusDiv.innerText = text;
    statusDiv.style.color = color;
    setTimeout(() => {
      statusDiv.innerText = "";
    }, 2500);
  }
});