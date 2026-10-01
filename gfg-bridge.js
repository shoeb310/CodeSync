// GeeksforGeeks Main-World Bridge Script (CodeSync)
// Runs in the page's MAIN execution world with full access to window.ace, window.monaco, and network APIs.
// Extracts the 100% complete solution buffer, eliminating Ace & Monaco virtual DOM scrolling truncation.

(function () {
  let lastCapturedCode = "";
  let lastCapturedLang = "";

  // 1. Monaco & Ace Direct Buffer Extractor
  function extractFromEditors() {
    let code = "";
    let lang = "";

    // Method A0: AMD require fallback for Monaco
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
            if (val && val.trim().length > code.length) {
              code = val;
              if (typeof m.getLanguageId === "function") {
                lang = m.getLanguageId();
              }
            }
          }
        }

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
      console.debug("[CodeSync GFG Bridge] Monaco extraction error:", e);
    }

    // Method B: Ace Editor
    if (!code) {
      try {
        if (window.ace && typeof window.ace.edit === "function") {
          const aceElements = document.querySelectorAll(".ace_editor, #editor, [class*='ace_editor']");
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
        console.debug("[CodeSync GFG Bridge] Ace extraction error:", e);
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
      new CustomEvent("CodeSync_GFG_Data", {
        detail: {
          code: code,
          language: lang || lastCapturedLang,
          source: source
        }
      })
    );
  }

  // 3. Inspect and extract code from any network request payload
  function inspectAndCapturePayload(body, url = "") {
    if (!body) return;

    let code = "";
    let lang = "";

    try {
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          code = parsed.code || parsed.user_code || parsed.sourceCode || parsed.source || parsed.solution || "";
          lang = parsed.language || parsed.lang || parsed.language_id || "";
        } catch (_) {
          if (body.includes("code=") || body.includes("user_code=") || body.includes("sourceCode=")) {
            const params = new URLSearchParams(body);
            code = params.get("code") || params.get("user_code") || params.get("sourceCode") || params.get("solution") || "";
            lang = params.get("language") || params.get("lang") || params.get("language_id") || "";
          }
        }
      } else if (body instanceof FormData) {
        code = body.get("code") || body.get("user_code") || body.get("sourceCode") || body.get("solution") || "";
        lang = body.get("language") || body.get("lang") || body.get("language_id") || "";
        if (typeof code !== "string") code = "";
        if (typeof lang !== "string") lang = "";
      }
    } catch (err) {
      console.debug("[CodeSync GFG Bridge] Payload parse error:", err);
    }

    if (code && typeof code === "string" && code.trim().length > 0) {
      broadcast(code, lang, "network-submit");
    }
  }

  // 4. Intercept fetch to capture exact submission payload
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
        console.debug("[CodeSync GFG Bridge] Fetch hook error:", err);
      }

      return originalFetch.apply(this, args);
    };
  } catch (e) {
    console.debug("[CodeSync GFG Bridge] Could not hook fetch:", e);
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
    console.debug("[CodeSync GFG Bridge] Could not hook XHR:", e);
  }

  // 6. Respond to on-demand code extraction requests from content script
  window.addEventListener("CodeSync_Request_GFG_Code", () => {
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
      if (text.includes("submit") || text.includes("compile")) {
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
