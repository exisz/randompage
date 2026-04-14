import type { LogtoNextConfig } from '@logto/next';

export const logtoConfig: LogtoNextConfig = {
  endpoint: process.env.LOGTO_ENDPOINT || 'https://id.rollersoft.com.au',
  appId: process.env.LOGTO_APP_ID || '',
  appSecret: process.env.LOGTO_APP_SECRET || '',
  baseUrl: process.env.LOGTO_BASE_URL || 'http://localhost:3000',
  cookieSecure: process.env.NODE_ENV === 'production',
  cookieSecret: process.env.LOGTO_COOKIE_SECRET || 'default-dev-secret-change-in-prod',
};
