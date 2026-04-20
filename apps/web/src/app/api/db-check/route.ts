import { checkDatabase } from "../../../lib/storage";

export async function GET() {
  const result = await checkDatabase();
  return Response.json(result);
}
