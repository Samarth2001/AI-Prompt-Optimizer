class ValidationService {
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return '';
    }
    // Basic sanitization: trim whitespace and remove control characters.
    return input.trim().replace(/[\x00-\x1F\x7F]/g, '');
  }

  sanitizePrompt(input, maxLength = 4000) {
    const sanitized = this.sanitizeInput(input);
    if (sanitized.length > maxLength) {
      return sanitized.slice(0, maxLength);
    }
    return sanitized;
  }
}

export const validationService = new ValidationService();
 