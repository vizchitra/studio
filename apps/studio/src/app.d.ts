// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
  namespace App {
    interface Locals {
      /** Populated from the Cloudflare Access authenticated-user header. */
      user: {
        email: string;
      } | null;
    }
    interface Platform {
      env: {
        DB: D1Database;
        MEDIA_BUCKET: R2Bucket;
        MEDIA_QUEUE: Queue;
      };
    }
  }
}

export {};
