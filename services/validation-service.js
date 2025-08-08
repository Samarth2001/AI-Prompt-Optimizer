class ValidationService {
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return '';
    }
    const hasBinaryControls = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(input);
    if (hasBinaryControls) {
      return '';
    }
    let sanitized = input;
    sanitized = sanitized.replace(/\r/g, '\n');
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    sanitized = sanitized.replace(/\t+/g, ' ');
    sanitized = sanitized.replace(/[ ]{2,}/g, ' ');
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    sanitized = sanitized.trim();
    return sanitized;
  }

  sanitizePrompt(input, maxLength = 4000) {
    const normalized = this.sanitizeInput(input);
    if (!normalized) return '';
    if (normalized.length > maxLength) {
      return normalized.slice(0, maxLength);
    }
    return normalized;
  }
}

export const validationService = new ValidationService();
 