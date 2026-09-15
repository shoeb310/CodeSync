// HackerRank Main-World Bridge Script (CodeSync)
// Runs in the page's MAIN execution world with full access to window.monaco, window.ace, and network APIs.

(function () {
  let lastCapturedCode = "";
  let lastCapturedLang = "";

  // 1. Monaco & Ace Direct Buffer Extractor
  function extractFromEditors() {
    let code = "";
    let lang = "";

    // Method A: Monaco Editor Models
    try {
      if (window.monaco && window.monaco.editor) {
        const editors = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
        for (const ed of editors) {
          if (ed && typeof ed.getValue === "function") {
            const val = ed.getValue();
            if (val && val.trim().length > 0) {
              code = val;
              const model = ed.getModel && ed.getModel();
              if (model && typeof model.getLanguageId === "function") {
                lang = model.getLanguageId();
              }
              break;
            }
          }
        }

        // Fallback to getModels() if getEditors() was empty or didn't return code
        if (!code) {
          const models = window.monaco.editor.getModels ? window.monaco.editor.getModels() : [];
          for (const m of models) {
            if (m && typeof m.getValue === "function") {
              const val = m.getValue();
              if (val && val.trim().length > code.length) {
                code = val;
                if (typeof m.getLanguageId === "function") {
                  lang = m.getLanguageId();
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.debug("[CodeSync Bridge] Monaco extraction error:", e);
    }

    // Method B: Ace Editor
    if (!code) {
      try {
        if (window.ace && typeof window.ace.edit === "function") {
          const aceElements = document.querySelectorAll(".ace_editor");
          for (const el of aceElements) {
            const editor = window.ace.edit(el);
            if (editor && typeof editor.getValue === "function") {
              const val = editor.getValue();
              if (val && val.trim().length > 0) {
                code = val;
                const mode = editor.session && editor.session.getMode && editor.session.getMode().$id;
                if (mode) lang = mode.split("/").pop();
                break;
              }
            }
          }
        }
      } catch (e) {
        console.debug("[CodeSync Bridge] Ace extraction error:", e);
      }
    }

    return { code, lang };
  }

  // 2. Broadcast captured code to the isolated world content script
  function broadcast(code, lang, source = "editor") {
    if (!code || !code.trim()) return;
    lastCapturedCode = code;
    if (lang) lastCapturedLang = lang;

    window.dispatchEvent(
      new CustomEvent("CodeSync_HackerRank_Data", {
        detail: {
          code: code,
          language: lang || lastCapturedLang,
          source: source
        }
      })
    );
  }

  // 3. Intercept fetch to capture exact submission payload sent to HackerRank backend
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const url = (args[0] && typeof args[0] === "string") ? args[0] : (args[0]?.url || "");
        if (url.includes("/submissions") || url.includes("/compile_tests")) {
          const init = args[1];
          if (init && init.body) {
            let bodyText = init.body;
            if (typeof bodyText === "string") {
              try {
                const parsed = JSON.parse(bodyText);
                if (parsed.code) {
                  broadcast(parsed.code, parsed.language, "fetch-intercept");
                }
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        console.debug("[CodeSync Bridge] Error in fetch interceptor:", err);
      }
      return originalFetch.apply(this, args);
    };
  } catch (e) {
    console.debug("[CodeSync Bridge] Could not hook fetch:", e);
  }

  // 4. Intercept XMLHttpRequest to capture XHR submissions as well
  try {
    const originalXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function (body) {
      try {
        if (body && typeof body === "string") {
          try {
            const parsed = JSON.parse(body);
            if (parsed.code) {
              broadcast(parsed.code, parsed.language, "xhr-intercept");
            }
          } catch (_) {}
        }
      } catch (err) {
        console.debug("[CodeSync Bridge] Error in XHR interceptor:", err);
      }
      return originalXhrSend.apply(this, arguments);
    };
  } catch (e) {
    console.debug("[CodeSync Bridge] Could not hook XHR:", e);
  }

  // 5. Respond to on-demand code extraction requests from content script
  window.addEventListener("CodeSync_Request_HackerRank_Code", () => {
    const extracted = extractFromEditors();
    if (extracted.code) {
      broadcast(extracted.code, extracted.lang, "on-demand");
    } else if (lastCapturedCode) {
      broadcast(lastCapturedCode, lastCapturedLang, "cached-fallback");
    }
  });

  // 6. Capture immediately on any Submit button click
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const text = (btn.innerText || btn.textContent || "").trim().toLowerCase();
      if (text.includes("submit code") || text === "submit" || text.includes("run code")) {
        const extracted = extractFromEditors();
        if (extracted.code) {
          broadcast(extracted.code, extracted.lang, "click-submit");
        }
      }
    },
    true
  );
})();
