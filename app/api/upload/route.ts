import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav",
          "audio/x-wav", "audio/x-flac", "audio/flac", "audio/webm",
          "video/mp4", "video/quicktime", "video/x-msvideo",
          "video/x-matroska", "video/webm",
        ],
        maximumSizeInBytes: 500 * 1024 * 1024, // 500MB
      }),
      onUploadCompleted: async () => {},
    });
    return Response.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[upload]", message);
    return new Response(message, { status: 400 });
  }
}
