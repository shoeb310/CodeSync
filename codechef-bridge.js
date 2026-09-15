// CodeChef Main-World Bridge Script (CodeSync)
// Runs in the page's MAIN execution world with direct access to window.monaco, window.ace, and network APIs.

(function () {
  let lastCapturedCode = "";
  let lastCapturedLang = "";

  // 1. Monaco & Ace Direct Buffer Extractor
  function extractFromEditors() {
    let code = "";
    let lang = "";

    // Method A0: AMD loader fallback (Monaco often loaded with requirejs)
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
      console.debug("[CodeSync CodeChef Bridge] Monaco extraction error:", e);
    }

    // Method B: Same-origin iframes
    if (!code) {
      try {
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          try {
            const cw = iframe.contentWindow;
            if (cw && cw.monaco && cw.monaco.editor) {
              const models = cw.monaco.editor.getModels();
              for (const m of models) {
                const val = m.getValue();
                if (val && val.trim().length > code.length) {
                  code = val;
                  if (typeof m.getLanguageId === "function") {
                    lang = m.getLanguageId();
                  }
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Method C: Ace Editor
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
        console.debug("[CodeSync CodeChef Bridge] Ace extraction error:", e);
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
      new CustomEvent("CodeSync_CodeChef_Data", {
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
          code = parsed.sourceCode || parsed.code || parsed.solution || parsed.program || parsed.source || parsed.user_code || "";
          lang = parsed.language || parsed.languageId || parsed.lang || parsed.lang_id || "";
        } catch (_) {
          if (body.includes("code=") || body.includes("sourceCode=") || body.includes("solution=")) {
            const params = new URLSearchParams(body);
            code = params.get("sourceCode") || params.get("code") || params.get("solution") || params.get("program") || "";
            lang = params.get("language") || params.get("languageId") || params.get("lang") || "";
          }
        }
      } else if (body instanceof FormData) {
        code = body.get("sourceCode") || body.get("code") || body.get("solution") || body.get("program") || "";
        lang = body.get("language") || body.get("languageId") || body.get("lang") || "";
        if (typeof code !== "string") code = "";
        if (typeof lang !== "string") lang = "";
      }
    } catch (err) {
      console.debug("[CodeSync CodeChef Bridge] Payload parse error:", err);
    }

    if (code && typeof code === "string" && code.trim().length > 0) {
      broadcast(code, lang, "network-payload");
      window.dispatchEvent(
        new CustomEvent("CodeSync_CodeChef_Submit_Started", {
          detail: { language: lang }
        })
      );
    }
  }

  // 4. Inspect response body for verdicts
  function inspectResponseText(text) {
    if (!text || text.length > 500000) return;
    try {
      const data = JSON.parse(text);
      const str = JSON.stringify(data).toLowerCase();

      // Negative checks
      if (
        str.includes("wrong answer") ||
        str.includes("time limit exceeded") ||
        str.includes("runtime error") ||
        str.includes("compilation error") ||
        str.includes("running") ||
        str.includes("judging") ||
        str.includes("in queue")
      ) {
        return;
      }

      const isAccepted =
        data.result_code === "accepted" ||
        data.result_code === "15" ||
        data.result === "AC" ||
        data.result === "accepted" ||
        data.status === "SUCCESS" ||
        data.status === "accepted" ||
        data.verdict === "Accepted" ||
        Number(data.score) === 100 ||
        Number(data.total_score) === 100 ||
        (data.message && data.message.toLowerCase().includes("accepted")) ||
        (str.includes('"accepted"') && (str.includes('"score":100') || str.includes('"score":"100"') || str.includes('"result":"ac"') || str.includes('"result_code":"accepted"')));

      if (isAccepted) {
        window.dispatchEvent(
          new CustomEvent("CodeSync_CodeChef_Verdict_Success", {
            detail: { data }
          })
        );
      }
    } catch (_) {}
  }

  // 5. Intercept fetch
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
        console.debug("[CodeSync CodeChef Bridge] Fetch hook error:", err);
      }

      const res = await originalFetch.apply(this, args);

      try {
        const clone = res.clone();
        clone.text().then(inspectResponseText).catch(() => {});
      } catch (_) {}

      return res;
    };
  } catch (e) {
    console.debug("[CodeSync CodeChef Bridge] Could not hook fetch:", e);
  }

  // 6. Intercept XMLHttpRequest
  try {
    const originalXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function (body) {
      try {
        inspectAndCapturePayload(body, this._codesync_url || "");
      } catch (_) {}

      try {
        this.addEventListener("load", function () {
          try {
            if (this.responseText) {
              inspectResponseText(this.responseText);
            }
          } catch (_) {}
        });
      } catch (_) {}

      return originalXhrSend.apply(this, arguments);
    };

    const originalXhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this._codesync_url = url;
      return originalXhrOpen.apply(this, arguments);
    };
  } catch (e) {
    console.debug("[CodeSync CodeChef Bridge] Could not hook XHR:", e);
  }

  // 7. Respond to on-demand code extraction requests
  window.addEventListener("CodeSync_Request_CodeChef_Code", () => {
    const extracted = extractFromEditors();
    if (extracted.code) {
      broadcast(extracted.code, extracted.lang, "on-demand");
    } else if (lastCapturedCode) {
      broadcast(lastCapturedCode, lastCapturedLang, "cached-fallback");
    }
  });

  // 8. Capture code on any Submit or Run button click
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("button, a, [role='button'], input[type='submit']");
      if (!btn) return;
      const text = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
      if (text.includes("submit") || text.includes("run")) {
        const extracted = extractFromEditors();
        if (extracted.code) {
          broadcast(extracted.code, extracted.lang, "click-submit");
        }
      }
    },
    true
  );

  // 9. Capture code on keyboard shortcut (Ctrl+Enter / Cmd+Enter)
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

  // 10. Periodic check every 3 seconds to keep latest editor buffer ready
  setInterval(() => {
    const extracted = extractFromEditors();
    if (extracted.code && extracted.code !== lastCapturedCode) {
      broadcast(extracted.code, extracted.lang, "interval-poll");
    }
  }, 3000);
})();
