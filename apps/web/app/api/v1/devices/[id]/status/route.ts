import { z } from "zod";
import { getDeviceStatus } from "@deviceops/core";
import { authenticate, json, problem, problemFromError, requestMetadata } from "@/lib/http";

const RoomIdSchema = z.uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    const roomId = RoomIdSchema.safeParse(new URL(request.url).searchParams.get("roomId"));
    if (!roomId.success) return problem(400, "ROOM_REQUIRED", "A valid roomId is required", metadata);
    const { id } = await context.params;
    return json({ status: await getDeviceStatus(session.user, roomId.data, id) }, metadata);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
