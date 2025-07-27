// Site-specific styling configurations
export const SITE_STYLES = {
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
export const SITE_SELECTORS = {
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
export function getSiteStyle() {
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
export function getSiteSelectors() {
  const hostname = window.location.hostname;
  for (const [site, selectors] of Object.entries(SITE_SELECTORS)) {
    if (hostname.includes(site)) {
      return selectors;
    }
  }
  return null;
}
