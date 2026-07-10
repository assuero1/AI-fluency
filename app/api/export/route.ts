import { handleApiError } from "@/lib/api/responses";
import { exportPersonalData } from "@/lib/learning/account";
import { buildPersonalDataExportFileName } from "@/lib/learning/export";

export async function GET() {
  try {
    const data = await exportPersonalData();
    const fileName = buildPersonalDataExportFileName(data.language?.code);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
