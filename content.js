// ============================================================================
// CONFIGURATION MODULE - Site-specific styling and selectors
// ============================================================================

// Site-specific styling configurations
const SITE_STYLES = {
  'claude.ai': {
    position: { top: '10px', right: '10px' },
    background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)', // Claude's warm orange theme
    hoverBackground: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    borderRadius: '8px',
    size: { width: '32px', height: '32px' },
    shadow: '0 2px 8px rgba(217, 119, 6, 0.3)',
    hoverShadow: '0 4px 16px rgba(245, 158, 11, 0.5)'
  },
  'gemini.google.com': {
    position: { top: '8px', right: '8px' },
    background: 'linear-gradient(135deg, #4285f4 0%, #1a73e8 100%)', // Google Blue
    hoverBackground: 'linear-gradient(135deg, #5a9cff 0%, #4285f4 100%)',
    borderRadius: '50%', // Circular for Google's design
    size: { width: '36px', height: '36px' },
    shadow: '0 2px 12px rgba(66, 133, 244, 0.3)',
    hoverShadow: '0 4px 20px rgba(90, 156, 255, 0.5)'
  },
  'chat.openai.com': {
    position: { top: '12px', right: '12px' },
    background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6b 100%)', // OpenAI Green
    hoverBackground: 'linear-gradient(135deg, #1db584 0%, #10a37f 100%)',
    borderRadius: '6px',
    size: { width: '34px', height: '34px' },
    shadow: '0 3px 10px rgba(16, 163, 127, 0.3)',
    hoverShadow: '0 6px 20px rgba(29, 181, 132, 0.5)'
  },
  'chatgpt.com': {
    position: { top: '12px', right: '12px' },
    background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6b 100%)', // OpenAI Green
    hoverBackground: 'linear-gradient(135deg, #1db584 0%, #10a37f 100%)',
    borderRadius: '6px',
    size: { width: '34px', height: '34px' },
    shadow: '0 3px 10px rgba(16, 163, 127, 0.3)',
    hoverShadow: '0 6px 20px rgba(29, 181, 132, 0.5)'
  },
  'grok.com': {
    position: { top: '10px', right: '10px' },
    background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)', // X/Twitter Blue
    hoverBackground: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    borderRadius: '10px',
    size: { width: '36px', height: '36px' },
    shadow: '0 4px 12px rgba(29, 78, 216, 0.3)',
    hoverShadow: '0 6px 24px rgba(59, 130, 246, 0.5)'
  }
};

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

// Get site-specific styling
function getSiteStyle() {
  const hostname = window.location.hostname;
  for (const [site, style] of Object.entries(SITE_STYLES)) {
    if (hostname.includes(site)) {
      return style;
    }
  }
  // Default fallback style
  return {
    position: { top: '10px', right: '10px' },
    background: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
    hoverBackground: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
    borderRadius: '12px',
    size: { width: '36px', height: '36px' },
    shadow: '0 4px 15px rgba(107, 114, 128, 0.3)',
    hoverShadow: '0 8px 25px rgba(255, 107, 107, 0.5)'
  };
}

// Get site-specific selectors
function getSiteSelectors() {
  const hostname = window.location.hostname;
  for (const [site, selectors] of Object.entries(SITE_SELECTORS)) {
    if (hostname.includes(site)) {
      return selectors;
    }
  }
  return null;
}

// ============================================================================
// DOM UTILITIES MODULE - DOM manipulation and helper functions
// ============================================================================

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

function findPositionedParent(textInput) {
  let parent = textInput.parentElement;
  
  // Walk up the DOM to find a suitable parent to position against
  while (parent && parent.tagName !== 'BODY') {
    const style = window.getComputedStyle(parent);
    if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
      return parent;
    }
    parent = parent.parentElement;
  }
  
  return null;
}

function createWrapper(textInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'enhance-button-wrapper';
  textInput.parentNode.insertBefore(wrapper, textInput);
  wrapper.appendChild(textInput);
  console.log('Created wrapper for text input');
  return wrapper;
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

// ============================================================================
// API SERVICE MODULE - Prompt enhancement communication
// ============================================================================

async function getStoredApiKey() {
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'getApiKey'
    });
    return result?.apiKey || null;
  } catch (error) {
    console.error('Error retrieving API key:', error);
    return null;
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

// ============================================================================
// BUTTON COMPONENT MODULE - Enhance button creation and styling
// ============================================================================

// Add global CSS for the enhance button with site-specific styling
function addGlobalCSS() {
  if (document.getElementById('prompt-enhancer-css')) return;

  const siteStyle = getSiteStyle();
  
  const style = document.createElement('style');
  style.id = 'prompt-enhancer-css';
  style.textContent = `
    .enhance-button-wrapper {
      position: relative !important;
      display: block !important;
    }
    .enhance-button {
      position: absolute !important;
      top: ${siteStyle.position.top} !important;
      right: ${siteStyle.position.right} !important;
      z-index: 9999 !important;
      background: ${siteStyle.background} !important;
      border: none !important;
      border-radius: ${siteStyle.borderRadius} !important;
      padding: 8px !important;
      width: ${siteStyle.size.width} !important;
      height: ${siteStyle.size.height} !important;
      cursor: pointer !important;
      transition: all 0.3s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: ${siteStyle.shadow} !important;
    }
    .enhance-button:hover {
      background: ${siteStyle.hoverBackground} !important;
      transform: translateY(-2px) scale(1.05) !important;
      box-shadow: ${siteStyle.hoverShadow} !important;
    }
    .enhance-button:active {
      transform: translateY(0px) scale(1) !important;
      box-shadow: ${siteStyle.shadow} !important;
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

function createEnhanceButton(textInput) {
  const button = document.createElement('button');
  button.className = 'enhance-button';
  button.textInput = textInput;
  button.type = 'button';

  const siteStyle = getSiteStyle();

  // Use SVG magic wand icon instead of PNG
  button.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 10.05c.39-.39.39-1.02 0-1.41l-2.33-2.35z"/>
    </svg>
  `;
  
  // Add hover effects with site-specific colors
  button.addEventListener('mouseenter', () => {
    button.style.background = siteStyle.hoverBackground + ' !important';
    button.style.transform = 'translateY(-2px) scale(1.05)';
    button.style.boxShadow = siteStyle.hoverShadow + ' !important';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = siteStyle.background + ' !important';
    button.style.transform = 'translateY(0px) scale(1)';
    button.style.boxShadow = siteStyle.shadow + ' !important';
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
    let wrapper = findPositionedParent(textInput);

    // If no suitable parent is found, wrap the text input
    if (!wrapper) {
      wrapper = createWrapper(textInput);
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

// ============================================================================
// MAIN INITIALIZATION MODULE - Entry point and page management
// ============================================================================

function processPage() {
  const textInputs = findTextInputs();
  console.log(`Found ${textInputs.length} text inputs on ${window.location.hostname}`);
  textInputs.forEach(addEnhanceButton);
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
