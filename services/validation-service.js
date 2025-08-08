class ValidationService {
  constructor() {
    this.apiKeyPatterns = {
      openrouter: /^sk-or-v1-[a-f0-9]{64}$/,
      openai: /^sk-[a-zA-Z0-9]{48,}$/,
      anthropic: /^sk-ant-[a-zA-Z0-9-_]{95,}$/,
      google: /^AIza[0-9A-Za-z-_]{35}$/,
      generic: /^sk-[a-zA-Z0-9-_]{20,}$/
    };
  }

  validateApiKeyFormat(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return {
        valid: false,
        error: 'API key must be a non-empty string',
        provider: null
      };
    }

    apiKey = apiKey.trim();

    if (apiKey.length < 20) {
      return {
        valid: false,
        error: 'API key is too short',
        provider: null
      };
    }

    for (const [provider, pattern] of Object.entries(this.apiKeyPatterns)) {
      if (pattern.test(apiKey)) {
        return {
          valid: true,
          error: null,
          provider: provider
        };
      }
    }

    return {
      valid: false,
      error: 'API key format not recognized. Please check the format.',
      provider: null
    };
  }

  async verifyApiKey(apiKey, provider = 'openrouter') {
    try {
      const endpoints = {
        openrouter: 'https://openrouter.ai/api/v1/models',
        openai: 'https://api.openai.com/v1/models',
        anthropic: 'https://api.anthropic.com/v1/messages',
        google: 'https://generativelanguage.googleapis.com/v1/models'
      };

      const endpoint = endpoints[provider] || endpoints.openrouter;
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key - authentication failed'
        };
      }

      if (response.status === 403) {
        return {
          valid: false,
          error: 'API key does not have required permissions'
        };
      }

      if (response.ok) {
        return {
          valid: true,
          error: null
        };
      }

      return {
        valid: false,
        error: `API verification failed with status: ${response.status}`
      };

    } catch (error) {
      return {
        valid: false,
        error: `Network error during verification: ${error.message}`
      };
    }
  }

  sanitizeApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return '';
    }
    return apiKey.trim().replace(/[\r\n\t]/g, '');
  }

  maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8) {
      return '***';
    }
    const start = apiKey.substring(0, 4);
    const end = apiKey.substring(apiKey.length - 4);
    return `${start}${'*'.repeat(Math.max(8, apiKey.length - 8))}${end}`;
  }
}

export const validationService = new ValidationService(); 