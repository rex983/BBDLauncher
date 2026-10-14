// Admin-only list / create for launcher_departments (migration 051). See src/lib/org/admin.ts.
import { orgCollectionHandlers } from "@/lib/org/admin";

const handlers = orgCollectionHandlers("departments");
export const GET = handlers.GET;
export const POST = handlers.POST;
