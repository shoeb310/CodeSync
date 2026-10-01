// LeetCode Main-World Bridge Script (CodeSync)
// Runs in the page's MAIN execution world with full access to window.monaco and network APIs.
// Extracts the 100% complete solution buffer, eliminating Monaco virtual DOM scrolling truncation (e.g. 24 lines).

(function () {
  let lastCapturedCode = "";
  let lastCapturedLang = "";

  // 1. Monaco Editor Direct Buffer Extractor
  function extractFromEditors() {
    let code = "";
    let lang = "";

    // Method A0: AMD loader fallback (if monaco is loaded via requirejs)
    if (!window.monaco && typeof window.require === "function") {
      try {
        const m = window.require("vs/editor/editor.main");
        if (m && m.editor) window.monaco = m;
      } catch (_) {}
    }

    // Method A: Monaco Editor Models
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels ? window.monaco.editor.getModels() : [];
        for (const m of models) {
          if (m && typeof m.getValue === "function") {
            const val = m.getValue();
            // Pick the model with the most content (the user's solution buffer)
            if (val && val.trim().length > code.length) {
              code = val;
              if (typeof m.getLanguageId === "function") {
                lang = m.getLanguageId();
              }
            }
          }
        }

        // Check active editors if models didn't return code
        if (!code && window.monaco.editor.getEditors) {
          const editors = window.monaco.editor.getEditors();
          for (const ed of editors) {
            if (ed && typeof ed.getValue === "function") {
              const val = ed.getValue();
              if (val && val.trim().length > code.length) {
                code = val;
                const model = ed.getModel && ed.getModel();
                if (model && typeof model.getLanguageId === "function") {
                  lang = model.getLanguageId();
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.debug("[CodeSync LeetCode Bridge] Monaco extraction error:", e);
    }

    return { code, lang };
  }

  // 2. Broadcast captured code to the isolated world content script
  function broadcast(code, lang, source = "editor") {
    if (!code || !code.trim()) return;
    lastCapturedCode = code;
    if (lang) lastCapturedLang = lang;

    window.dispatchEvent(
      new CustomEvent("CodeSync_LeetCode_Data", {
        detail: {
          code: code,
          language: lang || lastCapturedLang,
          source: source
        }
      })
    );
  }

  // 3. Inspect and extract code from any network request payload (e.g. POST /problems/*/submit/)
  function inspectAndCapturePayload(body, url = "") {
    if (!body) return;

    let code = "";
    let lang = "";

    try {
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          // LeetCode's submit payload uses 'typed_code' and 'lang'
          code = parsed.typed_code || parsed.code || parsed.sourceCode || parsed.solution || "";
          lang = parsed.lang || parsed.language || parsed.languageId || "";

          // GraphQL mutation format support
          if (!code && parsed.variables) {
            code = parsed.variables.typed_code || parsed.variables.code || parsed.variables.typedCode || "";
            lang = parsed.variables.lang || parsed.variables.language || "";
          }
        } catch (_) {
          if (body.includes("typed_code=") || body.includes("code=")) {
            const params = new URLSearchParams(body);
            code = params.get("typed_code") || params.get("code") || "";
            lang = params.get("lang") || params.get("language") || "";
          }
        }
      } else if (body instanceof FormData) {
        code = body.get("typed_code") || body.get("code") || "";
        lang = body.get("lang") || body.get("language") || "";
        if (typeof code !== "string") code = "";
        if (typeof lang !== "string") lang = "";
      }
    } catch (err) {
      console.debug("[CodeSync LeetCode Bridge] Payload parse error:", err);
    }

    if (code && typeof code === "string" && code.trim().length > 0) {
      broadcast(code, lang, "network-submit");
    }
  }

  // 4. Intercept fetch to capture exact submission payload sent to LeetCode backend
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        let body = null;
        let url = "";

        if (typeof args[0] === "string") {
          url = args[0];
          body = args[1] && args[1].body;
        } else if (args[0] && typeof args[0] === "object") {
          url = args[0].url || "";
          body = (args[1] && args[1].body) || args[0].body;
        }

        inspectAndCapturePayload(body, url);
      } catch (err) {
        console.debug("[CodeSync LeetCode Bridge] Fetch hook error:", err);
      }

      return originalFetch.apply(this, args);
    };
  } catch (e) {
    console.debug("[CodeSync LeetCode Bridge] Could not hook fetch:", e);
  }

  // 5. Intercept XMLHttpRequest
  try {
    const originalXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function (body) {
      try {
        inspectAndCapturePayload(body, this._codesync_url || "");
      } catch (_) {}
      return originalXhrSend.apply(this, arguments);
    };

    const originalXhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this._codesync_url = url;
      return originalXhrOpen.apply(this, arguments);
    };
  } catch (e) {
    console.debug("[CodeSync LeetCode Bridge] Could not hook XHR:", e);
  }

  // 6. Respond to on-demand code extraction requests from content script
  window.addEventListener("CodeSync_Request_LeetCode_Code", () => {
    const extracted = extractFromEditors();
    if (extracted.code) {
      broadcast(extracted.code, extracted.lang, "on-demand");
    } else if (lastCapturedCode) {
      broadcast(lastCapturedCode, lastCapturedLang, "cached-fallback");
    }
  });

  // 7. Capture code immediately on any Submit button click
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("button, a, [role='button']");
      if (!btn) return;
      const text = (btn.innerText || btn.textContent || "").trim().toLowerCase();
      if (text.includes("submit")) {
        const extracted = extractFromEditors();
        if (extracted.code) {
          broadcast(extracted.code, extracted.lang, "click-submit");
        }
      }
    },
    true
  );

  // 8. Capture code on keyboard shortcut (Ctrl+Enter / Cmd+Enter)
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        const extracted = extractFromEditors();
        if (extracted.code) {
          broadcast(extracted.code, extracted.lang, "shortcut-submit");
        }
      }
    },
    true
  );

  // 9. Periodic background sync every 2.5 seconds to keep cached buffer fresh
  setInterval(() => {
    const extracted = extractFromEditors();
    if (extracted.code && extracted.code !== lastCapturedCode) {
      broadcast(extracted.code, extracted.lang, "interval-poll");
    }
  }, 2500);
})();
