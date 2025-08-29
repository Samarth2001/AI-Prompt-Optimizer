function sanitizeText(text) {
  if (typeof text !== "string") return text;
  const temp = document.createElement("div");
  temp.textContent = text;
  return temp.textContent;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `prompt-enhancer-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 100);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 3000);
}

function formatErrorMessage(error) {
  if (typeof error === "string") {
    return sanitizeText(error);
  }
  if (typeof error === "object" && error !== null) {
    const status = error.status;
    const code = error.data?.code;

    if (status === 429 || code === "RATE_LIMIT_EXCEEDED") {
      return "Daily limit reached. Try again tomorrow.";
    }
    if (status === 401 || code === "UNAUTHORIZED") {
      return "Please reopen the popup.";
    }
    if (status >= 500 && status < 600) {
      return "Service is temporarily unavailable. Try again shortly.";
    }
    return sanitizeText(error.message) || "An unknown error occurred.";
  }
  return "An unknown error occurred.";
}

async function enhancePrompt(prompt) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "enhancePrompt", prompt },
      (response) => {
        if (response && response.success) {
          resolve(response.enhancedPrompt);
        } else {
          showToast(
            formatErrorMessage(response?.error) || "Unknown error",
            "error"
          );
          resolve(null);
        }
      }
    );
  });
}

async function handleEnhanceClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.target.closest(".enhance-button");
  const textInput = button.textInput;

  const currentText = window.__PE_utils.getTextFromElement(textInput);
  if (!currentText.trim()) {
    showToast("Please enter some text first!", "error");
    return;
  }

  const originalSvg = button.querySelector("svg");
  const originalStyles = {
    fontSize: button.style.fontSize,
    color: button.style.color,
  };

  button.textContent = "...";
  button.style.fontSize = "10px";
  button.style.opacity = "0.6";
  button.disabled = true;

  try {
    const enhancedPrompt = await enhancePrompt(currentText);
    if (enhancedPrompt) {
      window.__PE_utils.setTextToElement(textInput, enhancedPrompt);
      button.textContent = "✓";
      button.style.fontSize = "10px";
      button.style.color = "#28a745";
    } else {
      button.textContent = "✗";
      button.style.fontSize = "10px";
      button.style.color = "#dc3545";
    }
  } catch (error) {
    button.textContent = "✗";
    button.style.fontSize = "10px";
    button.style.color = "#dc3545";
  }

  setTimeout(() => {
    // Restore original SVG and styles
    button.textContent = "";
    if (originalSvg) {
      button.appendChild(originalSvg.cloneNode(true));
    }
    button.style.fontSize = originalStyles.fontSize || "";
    button.style.color = originalStyles.color || "";
    button.style.opacity = "1";
    button.disabled = false;
  }, 2000);
}

function createEnhanceButton(textInput) {
  const button = document.createElement("button");
  button.className = "enhance-button";
  button.textInput = textInput;
  button.type = "button";
  button.setAttribute("aria-label", "Enhance prompt");

  const siteStyle = window.__PE_config.getSiteStyle();

  // Create SVG element
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Create path element
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 10.05c.39-.39.39-1.02 0-1.41l-2.33-2.35z"
  );

  svg.appendChild(path);
  button.appendChild(svg);

  // Add hover effects with site-specific colors
  button.addEventListener("mouseenter", () => {
    button.style.background = siteStyle.hoverBackground + " !important";
    button.style.transform = "translateY(-2px) scale(1.05)";
    button.style.boxShadow = siteStyle.hoverShadow + " !important";
  });

  button.addEventListener("mouseleave", () => {
    button.style.background = siteStyle.background + " !important";
    button.style.transform = "translateY(0px) scale(1)";
    button.style.boxShadow = siteStyle.shadow + " !important";
  });

  button.addEventListener("click", handleEnhanceClick);
  return button;
}

function addEnhanceButton(textInput) {
  if (textInput.dataset.enhanced === "true") return;

  try {
    textInput.dataset.enhanced = "true";

    // Find the nearest positioned ancestor or create a wrapper
    let wrapper = window.__PE_utils.findPositionedParent(textInput);

    // If no suitable parent is found, wrap the text input
    if (!wrapper) {
      wrapper = window.__PE_utils.createWrapper(textInput);
    } else {
    }

    const button = createEnhanceButton(textInput);
    wrapper.appendChild(button);

    // Store cleanup function
    textInput._enhanceCleanup = () => {
      button.remove();
      // If we created a wrapper, unwrap it
      if (wrapper.classList.contains("enhance-button-wrapper")) {
        wrapper.parentNode.insertBefore(textInput, wrapper);
        wrapper.remove();
      }
      delete textInput.dataset.enhanced;
      delete textInput._enhanceCleanup;
    };
  } catch (error) {
    delete textInput.dataset.enhanced;
  }
}

function processPage() {
  const textInputs = window.__PE_utils.findTextInputs(
    window.__PE_config.getSiteSelectors()
  );
  textInputs.forEach(addEnhanceButton);
}

function addGlobalCSS() {
  if (document.getElementById("prompt-enhancer-css")) return;
  const siteStyle = window.__PE_config.getSiteStyle();
  const style = document.createElement("style");
  style.id = "prompt-enhancer-css";
  style.textContent = `
    .enhance-button-wrapper { position: relative !important; display: block !important; }
    .enhance-button { position: absolute !important; top: ${siteStyle.position.top} !important; right: ${siteStyle.position.right} !important; z-index: 9999 !important; background: ${siteStyle.background} !important; border: none !important; border-radius: ${siteStyle.borderRadius} !important; width: ${siteStyle.size.width} !important; height: ${siteStyle.size.height} !important; box-sizing: border-box !important; padding: 0 !important; cursor: pointer !important; transition: all 0.3s ease !important; display: flex !important; align-items: center !important; justify-content: center !important; box-shadow: ${siteStyle.shadow} !important; aspect-ratio: 1 / 1 !important; }
    .enhance-button:hover { background: ${siteStyle.hoverBackground} !important; transform: translateY(-2px) scale(1.05) !important; box-shadow: ${siteStyle.hoverShadow} !important; }
    .enhance-button:active { transform: translateY(0) scale(1) !important; box-shadow: ${siteStyle.shadow} !important; }
    .enhance-button > * { pointer-events: none !important; }
    .enhance-button svg { width: 66% !important; height: 66% !important; fill: white !important; transition: all 0.3s ease !important; }
    .prompt-enhancer-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 12px 20px; border-radius: 8px; background: #262626; color: #fafafa; font-size: 14px; z-index: 10000; opacity: 0; transition: all 0.4s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .prompt-enhancer-toast.show { opacity: 1; transform: translate(-50%, 10px); }
    .prompt-enhancer-toast.error { background: #ef4444; }
  `;
  document.head.appendChild(style);
}

function getFocusedTextInput() {
  let element = document.activeElement;
  if (!element) return null;
  while (element && element !== document.body) {
    if (element.tagName === "TEXTAREA") return element;
    if (
      element.tagName === "INPUT" &&
      (element.type === "text" || element.type === "search")
    )
      return element;
    if (element.isContentEditable) return element;
    element = element.parentElement;
  }
  return null;
}

function findEnhanceButtonForInput(textInput) {
  const buttons = document.querySelectorAll(".enhance-button");
  for (const btn of buttons) {
    if (btn.textInput === textInput) return btn;
  }
  return null;
}

function attachKeyboardShortcut() {
  if (window.__PE_keydownHandlerAttached) return;
  const handler = (e) => {
    const isModifier = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (!isModifier || e.repeat) return;
    const key = (e.key || "").toLowerCase();
    if (key !== "e") return;
    const focused = getFocusedTextInput();
    if (!focused) return;
    if (focused.dataset.enhanced !== "true") {
      try {
        addEnhanceButton(focused);
      } catch {}
    }
    const button = findEnhanceButtonForInput(focused);
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    button.click();
  };
  window.addEventListener("keydown", handler, true);
  window.__PE_keydownHandlerAttached = true;
  window.__PE_keydownHandler = handler;
}

function cleanup() {
  const selectors = window.__PE_config.getSiteSelectors();
  if (window.__PE_utils && typeof window.__PE_utils.cleanup === "function") {
    window.__PE_utils.cleanup(selectors);
  }
  if (window.__PE_keydownHandlerAttached && window.__PE_keydownHandler) {
    window.removeEventListener("keydown", window.__PE_keydownHandler, true);
    delete window.__PE_keydownHandlerAttached;
    delete window.__PE_keydownHandler;
  }
}

let processPageTimer = null;
const observer = new MutationObserver((mutations) => {
  const selectors = window.__PE_config.getSiteSelectors();

  if (!selectors) return;

  let needsProcessing = false;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const hasTextInput = selectors.some((selector) => {
          try {
            return (
              (node.matches && node.matches(selector)) ||
              (node.querySelectorAll &&
                node.querySelectorAll(selector).length > 0)
            );
          } catch (e) {
            return false;
          }
        });

        if (hasTextInput) {
          needsProcessing = true;
          break;
        }
      }
    }
    if (needsProcessing) break;
  }

  if (needsProcessing) {
    clearTimeout(processPageTimer);
    processPageTimer = setTimeout(processPage, 500);
  }
});

async function initialize() {
  const { getSiteStyle, getSiteSelectors } = await import(
    chrome.runtime.getURL("config/site-config.js")
  );
  const utils = await import(chrome.runtime.getURL("utils/dom-utils.js"));
  window.__PE_config = { getSiteStyle, getSiteSelectors };
  window.__PE_utils = utils;

  const selectors = window.__PE_config.getSiteSelectors();
  if (!selectors) {
    return;
  }

  addGlobalCSS();
  attachKeyboardShortcut();

  setTimeout(() => {
    processPage();
  }, 1000);

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("beforeunload", cleanup);
}

initialize();

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    cleanup();
    setTimeout(processPage, 2000);
  }
}).observe(document, { subtree: true, childList: true });

// --- Inline Turnstile overlay injection ---
function openTurnstileOverlay(embedUrl) {
  try {
    if (document.getElementById("pe-ts-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "pe-ts-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;";
    const modal = document.createElement("div");
    modal.style.cssText = "background:#111;border-radius:8px;padding:12px;width:340px;max-width:90%;margin:24px;box-shadow:0 20px 40px rgba(0,0,0,.5)";
    const frame = document.createElement("iframe");
    frame.src = embedUrl;
    frame.style.cssText = "border:0;width:100%;height:100px;border-radius:6px;background:#111";
    frame.setAttribute("allow", "clipboard-write");
    modal.appendChild(frame);
    overlay.appendChild(modal);
    overlay.addEventListener(
      "click",
      function (e) {
        if (e.target === overlay) closeTurnstileOverlay();
      },
      true
    );
    document.body.appendChild(overlay);

    function onMsg(ev) {
      try {
        const o = new URL(embedUrl).origin;
        if (ev.origin !== o) return;
        const d = ev.data || {};
        if (d.type === "turnstile:token" && d.token) {
          window.removeEventListener("message", onMsg);
          closeTurnstileOverlay();
          chrome.runtime.sendMessage({ action: "turnstileToken", token: String(d.token) });
        }
        if (d.type === "turnstile:cancel" || d.type === "turnstile:error" || d.type === "turnstile:timeout") {
          window.removeEventListener("message", onMsg);
          closeTurnstileOverlay();
          chrome.runtime.sendMessage({ action: "turnstileCanceled", reason: d.type });
        }
      } catch (_) {}
    }
    window.addEventListener("message", onMsg, false);
  } catch (_) {}
}

function closeTurnstileOverlay() {
  const el = document.getElementById("pe-ts-overlay");
  if (el) el.remove();
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  try {
    if (request && request.action === "startTurnstileOverlay" && request.embedUrl) {
      openTurnstileOverlay(request.embedUrl);
      sendResponse({ ok: true });
      return true;
    }
  } catch (_) {}
  return false;
});