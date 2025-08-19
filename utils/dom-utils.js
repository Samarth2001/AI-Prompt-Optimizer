// DOM manipulation utilities

export function getTextFromElement(element) {
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    return element.value;
  } else if (element.isContentEditable) {
    return element.textContent || element.innerText;
  }
  return '';
}

export function setTextToElement(element, text) {
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

export function findTextInputs(selectors) {
  // Only work on supported AI chat sites
  if (!selectors) {
    return [];
  }
  
  const inputs = [];

  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        // Filter out very small or hidden elements (Claude's textarea can be as short as 20px when empty)
        if (element.offsetWidth > 50 && element.offsetHeight >= 18) {
          inputs.push(element);
        } else {
        }
      });
    } catch (e) {
    }
  });

  // If no inputs found with specific selectors, try generic fallbacks for Claude and Grok
  if (inputs.length === 0 && (window.location.hostname.includes('claude.ai') || window.location.hostname.includes('grok.com'))) {
    const fallbackSelectors = [
      'textarea',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];
    
    fallbackSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          if (element.offsetWidth > 50 && element.offsetHeight >= 18) {
            inputs.push(element);
          }
        });
      } catch (e) {
      }
    });
  }

  return inputs;
}

export function findPositionedParent(textInput) {
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

export function createWrapper(textInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'enhance-button-wrapper';
  textInput.parentNode.insertBefore(wrapper, textInput);
  wrapper.appendChild(textInput);
  return wrapper;
}

export function cleanup(selectors) {
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
    }
  });
}
