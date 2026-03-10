import { vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    PORT: 0,
    HOST: '127.0.0.1',
    CREDENTIALS_MASTER_KEY: 'test-master-key-0123456789abcdef0123456789abcdef',
    SCRAPE_CRON: '0 6 * * *',
    SCRAPE_TIMEZONE: 'Asia/Jerusalem',
    SCRAPE_START_DATE_MONTHS_BACK: 3,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    AI_PROVIDER: 'anthropic',
    AI_CHAT_MODEL: '',
    AI_BATCH_PROVIDER: '',
    AI_BATCH_MODEL_ID: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    API_TOKEN: 'test-token',
    CORS_ORIGIN: undefined,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_ALLOWED_USERS: undefined,
    SCRAPE_TIMEOUT: 120000,
    SCRAPE_SHOW_BROWSER: false,
  },
  isElectronMode: false,
  loadConfigFile: () => null,
  saveConfigFile: vi.fn(),
}));

vi.mock('../paths.js', () => ({
  dataDir: '/tmp/test-money-monitor',
  dbPath: ':memory:',
  credentialsPath: '/tmp/test-money-monitor/credentials.enc',
  chatDir: '/tmp/test-money-monitor/chat',
  sessionsDir: '/tmp/test-money-monitor/chat/sessions',
  configPath: '/tmp/test-money-monitor/config.json',
}));

vi.mock('../scraper/scheduler.js', () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
}));

vi.mock('../telegram/bot.js', () => ({
  startTelegramBot: vi.fn(),
  stopTelegramBot: vi.fn(),
}));
