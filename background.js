// Listen for messages dispatched by content scripts (e.g., leetcode.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_ACCEPTED") {
    commitToGitHub(message.payload);
  }
});

async function commitToGitHub(payload) {
  const { platform, problemNumber, problemTitle, languageExtension, code } = payload;

  // Retrieve stored GitHub credentials and auto-sync status
  const config = await chrome.storage.sync.get(["autoSync", "ghToken", "ghRepo"]);
  
  if (!config.autoSync) {
    console.log("[CodeSync] Auto-sync is currently disabled. Skipping.");
    return;
  }

  if (!config.ghToken || !config.ghRepo) {
    console.error("[CodeSync] Missing GitHub Token or Repository configuration.");
    return;
  }

  // Sanitize filename and format path: e.g., LeetCode/0001_Two_Sum.cpp
  // const safeNumber = problemNumber.toString().padStart(4, "0");
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
  const commitMessage = `Solve [${platform}] ${problemNumber}: ${problemTitle}`;

  const apiUrl = `https://api.github.com/repos/${config.ghRepo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${config.ghToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  try {
    // 1. Check if the file already exists to obtain its SHA (required by GitHub API to update a file)
    let fileSha = null;
    const checkResponse = await fetch(apiUrl, { headers });
    
    if (checkResponse.ok) {
      const fileMeta = await checkResponse.json();
      fileSha = fileMeta.sha;
    }

    // 2. Base64-encode code payload safely for Unicode/UTF-8 characters
    const encodedContent = btoa(unescape(encodeURIComponent(code)));

    // 3. Create or update file on the default branch
    const putResponse = await fetch(apiUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: commitMessage,
        content: encodedContent,
        sha: fileSha || undefined
      })
    });

    if (putResponse.ok) {
      console.log(`[CodeSync] Successfully committed: ${filePath}`);
    } else {
      const errorData = await putResponse.json();
      console.error("[CodeSync] GitHub API commit failed:", errorData);
    }
  } catch (err) {
    console.error("[CodeSync] Network or runtime error during commit:", err);
  }
}