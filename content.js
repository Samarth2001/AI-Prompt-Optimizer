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

async function enhancePrompt(prompt) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "enhancePrompt", prompt },
      (response) => {
        if (response && response.success) {
          resolve(response.enhancedPrompt);
        } else {
          showToast(response?.error || "Unknown error", "error");
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

  const originalContent = button.innerHTML;
  button.innerHTML = '<div style="font-size: 10px;">...</div>';
  button.style.opacity = "0.6";
  button.disabled = true;

  try {
    const enhancedPrompt = await enhancePrompt(currentText);
    if (enhancedPrompt) {
      window.__PE_utils.setTextToElement(textInput, enhancedPrompt);
      button.innerHTML =
        '<div style="font-size: 10px; color: #28a745;">✓</div>';
    } else {
      button.innerHTML =
        '<div style="font-size: 10px; color: #dc3545;">✗</div>';
    }
  } catch (error) {
    button.innerHTML = '<div style="font-size: 10px; color: #dc3545;">✗</div>';
  }

  setTimeout(() => {
    button.innerHTML = originalContent;
    button.style.opacity = "1";
    button.disabled = false;
  }, 2000);
}

function createEnhanceButton(textInput) {
  const button = document.createElement("button");
  button.className = "enhance-button";
  button.textInput = textInput;
  button.type = "button";

  const siteStyle = window.__PE_config.getSiteStyle();

  // Use SVG magic wand icon instead of PNG
  button.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 10.05c.39-.39.39-1.02 0-1.41l-2.33-2.35z"/>
    </svg>
  `;

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
    console.log("Adding enhance button to:", textInput);

    // Find the nearest positioned ancestor or create a wrapper
    let wrapper = window.__PE_utils.findPositionedParent(textInput);

    // If no suitable parent is found, wrap the text input
    if (!wrapper) {
      wrapper = window.__PE_utils.createWrapper(textInput);
    } else {
      console.log("Using existing positioned parent:", wrapper);
    }

    const button = createEnhanceButton(textInput);
    wrapper.appendChild(button);
    console.log("Button added successfully");

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
    console.error("Failed to add enhance button:", error);
    delete textInput.dataset.enhanced;
  }
}

function processPage() {
  const textInputs = window.__PE_utils.findTextInputs(
    window.__PE_config.getSiteSelectors()
  );
  console.log(
    `Found ${textInputs.length} text inputs on ${window.location.hostname}`
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
    if (element.tagName === 'TEXTAREA') return element;
    if (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'search')) return element;
    if (element.isContentEditable) return element;
    element = element.parentElement;
  }
  return null;
}

function findEnhanceButtonForInput(textInput) {
  const buttons = document.querySelectorAll('.enhance-button');
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
    const key = (e.key || '').toLowerCase();
    if (key !== 'e') return;
    const focused = getFocusedTextInput();
    if (!focused) return;
    if (focused.dataset.enhanced !== 'true') {
      try { addEnhanceButton(focused); } catch {}
    }
    const button = findEnhanceButtonForInput(focused);
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    button.click();
  };
  window.addEventListener('keydown', handler, true);
  window.__PE_keydownHandlerAttached = true;
  window.__PE_keydownHandler = handler;
}

function cleanup() {
  const selectors = window.__PE_config.getSiteSelectors();
  if (window.__PE_utils && typeof window.__PE_utils.cleanup === "function") {
    window.__PE_utils.cleanup(selectors);
  }
  if (window.__PE_keydownHandlerAttached && window.__PE_keydownHandler) {
    window.removeEventListener('keydown', window.__PE_keydownHandler, true);
    delete window.__PE_keydownHandlerAttached;
    delete window.__PE_keydownHandler;
  }
}

const observer = new MutationObserver((mutations) => {
  const selectors = window.__PE_config.getSiteSelectors();

  // Only observe on supported AI chat sites
  if (!selectors) return;

  let needsProcessing = false;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Check if the new node itself is the input, or contains the input
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
    // Use a timeout to allow the page to finish rendering
    setTimeout(processPage, 500);
  }
});

async function initialize() {
  console.log("Prompt Enhancer: Checking site -", window.location.hostname);
  // Load shared config and utils to eliminate drift
  const { getSiteStyle, getSiteSelectors } = await import(
    chrome.runtime.getURL("config/site-config.js")
  );
  const utils = await import(chrome.runtime.getURL("utils/dom-utils.js"));
  // Attach to window to keep current function calls minimal
  window.__PE_config = { getSiteStyle, getSiteSelectors };
  window.__PE_utils = utils;

  // Only initialize on supported AI chat sites
  const selectors = window.__PE_config.getSiteSelectors();
  if (!selectors) {
    console.log(
      "Prompt Enhancer: Site not supported, extension will not activate"
    );
    return;
  }

  console.log(
    "Prompt Enhancer: Initializing on supported AI site -",
    window.location.hostname
  );
  addGlobalCSS();
  attachKeyboardShortcut();

  // Initial run with a small delay to ensure page is loaded
  setTimeout(() => {
    processPage();
  }, 1000);

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log("Prompt Enhancer: Initialization complete");
}

// Start the process
initialize();

// Cleanup on page unload
window.addEventListener("beforeunload", cleanup);

// Re-process on navigation for SPA sites
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    cleanup();
    setTimeout(processPage, 2000);
  }
}).observe(document, { subtree: true, childList: true });
