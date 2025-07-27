// Add global CSS for the enhance button
function addGlobalCSS() {
  if (document.getElementById('prompt-enhancer-css')) return;

  const style = document.createElement('style');
  style.id = 'prompt-enhancer-css';
  style.textContent = `
    .enhance-button-wrapper {
      position: relative !important;
      display: block !important;
    }
    .enhance-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      z-index: 9999 !important;
      background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%) !important;
      border: none !important;
      border-radius: 12px !important;
      padding: 8px !important;
      width: 36px !important;
      height: 36px !important;
      cursor: pointer !important;
      transition: all 0.3s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 4px 15px rgba(107, 114, 128, 0.3) !important;
    }
    .enhance-button:hover {
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%) !important;
      transform: translateY(-2px) scale(1.05) !important;
      box-shadow: 0 8px 25px rgba(255, 107, 107, 0.5) !important;
    }
    .enhance-button:active {
      transform: translateY(0px) scale(1) !important;
      box-shadow: 0 4px 15px rgba(107, 114, 128, 0.3) !important;
    }
    .enhance-button svg {
      width: 18px !important;
      height: 18px !important;
      fill: white !important;
      transition: all 0.3s ease !important;
    }
  `;
  document.head.appendChild(style);
}

// Site-specific selectors for the main text input area
const SITE_SELECTORS = {
  'claude.ai': [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[aria-label*="Write your prompt to Claude"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="Talk to Claude"]',
    'textarea[placeholder*="Message"]',
    'textarea[data-testid*="chat"]',
    '[role="textbox"][contenteditable="true"]',
    'textarea'
  ],
  'gemini.google.com': [
    '.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'textarea[placeholder*="Enter a prompt"]',
    'textarea[placeholder*="Ask Gemini"]'
  ],
  'chat.openai.com': [
    '#prompt-textarea',
    'textarea[placeholder*="Message"]',
    'textarea'
  ],
  'chatgpt.com': [
    '#prompt-textarea',
    'textarea[placeholder*="Message"]',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]'
  ],
  'grok.com': [
    'textarea[placeholder*="Ask Grok"]',
    'textarea[placeholder*="Message"]',
    'div[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    'textarea'
  ]
};

function getSiteSelectors() {
  const hostname = window.location.hostname;
  for (const [site, selectors] of Object.entries(SITE_SELECTORS)) {
    if (hostname.includes(site)) {
      return selectors;
    }
  }
   return null;
}

// --- Core API and Button Logic ---

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
  const textInput = button.textInput;

  const currentText = getTextFromElement(textInput);
  if (!currentText.trim()) {
    alert('Please enter some text first!');
    return;
  }

  const originalContent = button.innerHTML;
  button.innerHTML = '<div style="font-size: 10px;">...</div>';
  button.style.opacity = '0.6';
  button.disabled = true;

  try {
    const enhancedPrompt = await enhancePrompt(currentText);
    if (enhancedPrompt) {
      setTextToElement(textInput, enhancedPrompt);
      button.innerHTML = '<div style="font-size: 10px; color: #28a745;">✓</div>';
    } else {
      button.innerHTML = '<div style="font-size: 10px; color: #dc3545;">✗</div>';
    }
  } catch (error) {
    console.error('Enhancement failed:', error);
    button.innerHTML = '<div style="font-size: 10px; color: #dc3545;">✗</div>';
  }

  setTimeout(() => {
    button.innerHTML = originalContent;
    button.style.opacity = '1';
    button.disabled = false;
  }, 2000);
}

// --- New Button Injection Logic ---

function createEnhanceButton(textInput) {
  const button = document.createElement('button');
  button.className = 'enhance-button';
  button.textInput = textInput;
  button.type = 'button';

  // Use SVG magic wand icon instead of PNG
  button.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 10.05c.39-.39.39-1.02 0-1.41l-2.33-2.35z"/>
    </svg>
  `;
  
  // Add hover effects
  button.addEventListener('mouseenter', () => {
    button.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%) !important';
    button.style.transform = 'translateY(-2px) scale(1.05)';
    button.style.boxShadow = '0 8px 25px rgba(255, 107, 107, 0.5) !important';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%) !important';
    button.style.transform = 'translateY(0px) scale(1)';
    button.style.boxShadow = '0 4px 15px rgba(107, 114, 128, 0.3) !important';
  });

  button.addEventListener('click', handleEnhanceClick);
  return button;
}

function addEnhanceButton(textInput) {
  if (textInput.dataset.enhanced === 'true') return;
  
  try {
    textInput.dataset.enhanced = 'true';
    console.log('Adding enhance button to:', textInput);

    // Find the nearest positioned ancestor or create a wrapper
    let parent = textInput.parentElement;
    let wrapper;

    // Walk up the DOM to find a suitable parent to position against
    while (parent && parent.tagName !== 'BODY') {
      const style = window.getComputedStyle(parent);
      if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
        wrapper = parent;
        break;
      }
      parent = parent.parentElement;
    }

    // If no suitable parent is found, wrap the text input
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'enhance-button-wrapper';
      textInput.parentNode.insertBefore(wrapper, textInput);
      wrapper.appendChild(textInput);
      console.log('Created wrapper for text input');
    } else {
      console.log('Using existing positioned parent:', wrapper);
    }

    const button = createEnhanceButton(textInput);
    wrapper.appendChild(button);
    console.log('Button added successfully');

    // Store cleanup function
    textInput._enhanceCleanup = () => {
      button.remove();
      // If we created a wrapper, unwrap it
      if (wrapper.classList.contains('enhance-button-wrapper')) {
          wrapper.parentNode.insertBefore(textInput, wrapper);
          wrapper.remove();
      }
      delete textInput.dataset.enhanced;
      delete textInput._enhanceCleanup;
    };
  } catch (error) {
    console.error('Failed to add enhance button:', error);
    delete textInput.dataset.enhanced;
  }
}

function findTextInputs() {
  const selectors = getSiteSelectors();
  
  // Only work on supported AI chat sites
  if (!selectors) {
    console.log('Prompt Enhancer: Site not supported -', window.location.hostname);
    return [];
  }
  
  const inputs = [];
  console.log('Prompt Enhancer: Searching with selectors:', selectors);

  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      console.log(`Selector "${selector}" found ${elements.length} elements`);
      elements.forEach(element => {
        // Filter out very small or hidden elements (Claude's textarea can be as short as 20px when empty)
        if (element.offsetWidth > 50 && element.offsetHeight >= 18) {
          console.log('Adding valid element:', element, `Size: ${element.offsetWidth}x${element.offsetHeight}`);
          inputs.push(element);
        } else {
          console.log('Skipping small element:', element, `Size: ${element.offsetWidth}x${element.offsetHeight}`);
        }
      });
    } catch (e) {
      console.log('Selector failed:', selector, e);
    }
  });

  // If no inputs found with specific selectors, try generic fallbacks for Claude and Grok
  if (inputs.length === 0 && (window.location.hostname.includes('claude.ai') || window.location.hostname.includes('grok.com'))) {
    console.log('No inputs found with specific selectors, trying fallbacks for', window.location.hostname);
    const fallbackSelectors = [
      'textarea',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];
    
    fallbackSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        console.log(`Fallback selector "${selector}" found ${elements.length} elements`);
        elements.forEach(element => {
          if (element.offsetWidth > 50 && element.offsetHeight >= 18) {
            console.log('Adding fallback element:', element);
            inputs.push(element);
          }
        });
      } catch (e) {
        console.log('Fallback selector failed:', selector, e);
      }
    });
  }

  return inputs;
}

function processPage() {
  const textInputs = findTextInputs();
  console.log(`Found ${textInputs.length} text inputs on ${window.location.hostname}`);
  textInputs.forEach(addEnhanceButton);
}

function cleanup() {
    const selectors = getSiteSelectors();
    
    // Only cleanup on supported AI chat sites
    if (!selectors) return;
    
    selectors.forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(input => {
                if (input._enhanceCleanup) {
                    input._enhanceCleanup();
                }
            });
        } catch (e) {
            console.log('Cleanup selector failed:', selector);
        }
    });
}

// --- Observer and Initializer ---

const observer = new MutationObserver((mutations) => {
  const selectors = getSiteSelectors();
  
  // Only observe on supported AI chat sites
  if (!selectors) return;
  
  let needsProcessing = false;
  
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Check if the new node itself is the input, or contains the input
        const hasTextInput = selectors.some(selector => {
          try {
            return node.matches && node.matches(selector) ||
                   node.querySelectorAll && node.querySelectorAll(selector).length > 0;
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

function initialize() {
    console.log('Prompt Enhancer: Checking site -', window.location.hostname);
    
    // Only initialize on supported AI chat sites
    const selectors = getSiteSelectors();
    if (!selectors) {
        console.log('Prompt Enhancer: Site not supported, extension will not activate');
        return;
    }
    
    console.log('Prompt Enhancer: Initializing on supported AI site -', window.location.hostname);
    addGlobalCSS();
    
    // Initial run with a small delay to ensure page is loaded
    setTimeout(() => {
        processPage();
    }, 1000);
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    console.log('Prompt Enhancer: Initialization complete');
}

// Start the process
initialize();

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
