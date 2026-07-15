import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// Streams an object straight out of the media R2 bucket. Access already
// gates this whole domain (see apps/studio/wrangler.toml's route), so no
// separate auth check is needed here — same trust boundary as every other
// page in this app.
export const GET: RequestHandler = async ({ params, platform }) => {
  const object = await platform?.env.MEDIA_BUCKET.get(params.key);
  if (!object) {
    error(404, "Not found");
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
};
