/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VIVERSE_APP_ID?: string;
  readonly VITE_VIVERSE_CLIENT_ID?: string;
  readonly VITE_POLYGON_UPLOAD_ENDPOINT?: string;
  readonly VITE_POLYGON_CMS_URL?: string;
  readonly VITE_GIFT_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
