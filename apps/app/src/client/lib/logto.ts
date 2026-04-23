import LogtoClient from '@logto/browser';

const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT as string || 'https://id.rollersoft.com.au';
const appId = import.meta.env.VITE_LOGTO_APP_ID as string;
export const API_RESOURCE = import.meta.env.VITE_LOGTO_API_RESOURCE as string || 'https://randompage.rollersoft.com.au/api';

export const logtoClient = new LogtoClient({
  endpoint,
  appId,
  resources: [API_RESOURCE],
});

export const redirectUri = `${window.location.origin}/callback`;
export const postSignOutRedirectUri = `${window.location.origin}/`;
