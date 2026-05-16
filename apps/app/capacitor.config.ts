import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.com.rollersoft.randompage',
  appName: 'RandomPage',
  webDir: 'dist',
  server: {
    url: 'https://app.randompage.rollersoft.com.au',
    cleartext: false,
  },
  android: {
    path: 'android',
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
