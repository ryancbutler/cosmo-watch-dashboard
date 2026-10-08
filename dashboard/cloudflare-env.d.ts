declare namespace Cloudflare {
  interface Env {
    COSMO_DATA_MODE?: string;
    SELF_HOSTED?: string;
    DASHBOARD_USERNAME?: string;
    DASHBOARD_PASSWORD?: string;
    DASHBOARD_AUTH_ENABLED?: string;
    COSMO_COLLECTOR_TOKEN?: string;
    COSMO_EMAIL?: string;
    COSMO_PASSWORD?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
