import { jsonOk } from "@/lib/api/responses";
import { getTeableStatus } from "@/lib/teable/config";
import { teableSchema } from "@/lib/teable/schema";

export async function GET() {
  return jsonOk({
    ok: true,
    status: getTeableStatus(),
    schema: teableSchema
  });
}
