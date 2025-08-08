// Enhance button component

import { getSiteStyle } from '../config/site-config.js';
import { getTextFromElement, setTextToElement, findPositionedParent, createWrapper } from '../utils/dom-utils.js';
import { enhancePrompt } from '../services/api-service.js';

// Add global CSS for the enhance button with site-specific styling
export function addGlobalCSS() {
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

export function createEnhanceButton(textInput) {
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

export function addEnhanceButton(textInput) {
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
