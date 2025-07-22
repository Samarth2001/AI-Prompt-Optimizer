// Add global CSS for enhance buttons
function addGlobalCSS() {
  if (document.getElementById('prompt-enhancer-css')) return;
  
  const style = document.createElement('style');
  style.id = 'prompt-enhancer-css';
  style.textContent = `
    .enhance-button:hover {
      transform: scale(1.1) !important;
    }
    .enhance-button:active {
      transform: scale(0.95) !important;
    }
    /* Ensure button stays visible on dark themes */
    .enhance-button {
      filter: drop-shadow(0 0 3px rgba(0,0,0,0.5)) !important;
    }
  `;
  document.head.appendChild(style);
}

// Site-specific selectors for different AI platforms
const SITE_SELECTORS = {
  'claude.ai': [
    'div[contenteditable="true"]',
    'textarea',
    '.ProseMirror'
  ],
  'gemini.google.com': [
    'rich-textarea div[contenteditable="true"]',
    'textarea[placeholder*="Enter a prompt"]',
    'textarea[placeholder*="Ask Gemini"]',
    '.ql-editor'
  ],
  'chat.openai.com': [
    'textarea[placeholder*="Message"]',
    '#prompt-textarea',
    'textarea'
  ],
  'bard.google.com': [
    'rich-textarea div[contenteditable="true"]',
    'textarea',
    '.ql-editor'
  ],
  'poe.com': [
    'textarea[placeholder*="Talk"]',
    'textarea',
    '.ChatMessageInputContainer textarea'
  ],
  'character.ai': [
    'textarea[placeholder*="Type"]',
    'textarea'
  ]
};

// Get current site's selectors
function getSiteSelectors() {
  const hostname = window.location.hostname;
  for (const [site, selectors] of Object.entries(SITE_SELECTORS)) {
    if (hostname.includes(site)) {
      return selectors;
    }
  }
  // Default selectors for any site
  return ['textarea', 'input[type="text"]', 'div[contenteditable="true"]'];
}

function findTextInputs() {
  const selectors = getSiteSelectors();
  const inputs = [];
  
  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        // Filter out very small or hidden elements
        if (element.offsetWidth > 100 && element.offsetHeight > 30) {
          inputs.push(element);
        }
      });
    } catch (e) {
      console.log('Selector failed:', selector);
    }
  });
  
  return inputs;
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (result) => {
      resolve(result.apiKey || null);
    });
  });
}

function getTextFromElement(element) {
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    return element.value;
  } else if (element.isContentEditable) {
    return element.textContent || element.innerText;
  }
  return '';
}

function setTextToElement(element, text) {
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (element.isContentEditable) {
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('keyup', { bubbles: true }));
  }
}

async function enhancePrompt(prompt) {
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    alert('Please set your API key in the extension popup first!');
    return null;
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'enhancePrompt', apiKey, prompt },
      (response) => {
        if (response && response.success) {
          resolve(response.enhancedPrompt);
        } else {
          console.error('Enhancement failed:', response?.error);
          alert('Enhancement failed: ' + (response?.error || 'Unknown error'));
          resolve(null);
        }
      }
    );
  });
}

async function handleEnhanceClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const button = event.target.closest('.enhance-button');
  const textInput = button.textInput; // Store reference when creating button
  
  const currentText = getTextFromElement(textInput);
  if (!currentText.trim()) {
    alert('Please enter some text first!');
    return;
  }

  // Update button state
  const originalContent = button.innerHTML;
  button.innerHTML = '<div style="font-size: 10px;">...</div>';
  button.style.opacity = '0.6';
  button.disabled = true;

  try {
    const enhancedPrompt = await enhancePrompt(currentText);
    if (enhancedPrompt) {
      setTextToElement(textInput, enhancedPrompt);
      
      // Success feedback
      button.innerHTML = '<div style="font-size: 10px; color: #28a745;">✓</div>';
      setTimeout(() => {
        button.innerHTML = originalContent;
        button.style.opacity = '1';
      }, 2000);
    }
  } catch (error) {
    console.error('Enhancement failed:', error);
    button.innerHTML = '<div style="font-size: 10px; color: #dc3545;">✗</div>';
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.style.opacity = '1';
    }, 2000);
  }

  button.disabled = false;
}

function createEnhanceButton(textInput) {
  const button = document.createElement('button');
  button.className = 'enhance-button';
  button.textInput = textInput; // Store reference
  button.type = 'button';
  
  // Use extension icon
  const iconUrl = chrome.runtime.getURL('icons/icon16.png');
  button.innerHTML = `<img src="${iconUrl}" style="width: 14px; height: 14px;" alt="Enhance">`;
  
  button.style.cssText = `
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    z-index: 10000 !important;
    background: #007bff !important;
    color: white !important;
    border: none !important;
    border-radius: 50% !important;
    padding: 6px !important;
    width: 28px !important;
    height: 28px !important;
    cursor: pointer !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
    transition: all 0.2s ease !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 12px !important;
  `;
  
  button.addEventListener('mouseenter', () => {
    button.style.background = '#0056b3 !important';
    button.style.transform = 'scale(1.1)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.background = '#007bff !important';
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('click', handleEnhanceClick);
  return button;
}

function addEnhanceButton(textInput) {
  // Skip if already enhanced
  if (textInput.dataset.enhanced === 'true') return;
  
  // Create wrapper div
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: relative !important;';
  
  // Get the parent and insert wrapper
  const parent = textInput.parentNode;
  parent.insertBefore(wrapper, textInput);
  wrapper.appendChild(textInput);

  // Create and add button
  const button = createEnhanceButton(textInput);
  wrapper.appendChild(button);
  
  textInput.dataset.enhanced = 'true';
  
  // Store cleanup function
  textInput._enhanceCleanup = () => {
    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(textInput, wrapper);
      wrapper.remove();
    }
    textInput.dataset.enhanced = 'false';
    delete textInput._enhanceCleanup;
  };
}

function processPage() {
  const textInputs = findTextInputs();
  console.log(`Found ${textInputs.length} text inputs on ${window.location.hostname}`);
  textInputs.forEach(addEnhanceButton);
}

// Cleanup function for page navigation
function cleanup() {
  document.querySelectorAll('[data-enhanced="true"]').forEach(input => {
    if (input._enhanceCleanup) {
      input._enhanceCleanup();
    }
  });
}

// Watch for dynamically added elements (important for SPA sites)
const observer = new MutationObserver((mutations) => {
  let shouldProcess = false;
  
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const selectors = getSiteSelectors();
        const hasTextInput = selectors.some(selector => {
          try {
            return node.matches && node.matches(selector) || 
                   node.querySelectorAll && node.querySelectorAll(selector).length > 0;
          } catch (e) {
            return false;
          }
        });
        
        if (hasTextInput) {
          shouldProcess = true;
        }
      }
    });
  });
  
  if (shouldProcess) {
    setTimeout(processPage, 500); // Small delay for dynamic content
  }
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Process existing elements
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    addGlobalCSS();
    setTimeout(processPage, 1000);
  });
} else {
  addGlobalCSS();
  setTimeout(processPage, 1000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

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