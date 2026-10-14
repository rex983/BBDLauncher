// Admin-only edit (display name / order) and delete-when-unused. Names are immutable.
import { orgItemHandlers } from "@/lib/org/admin";

const handlers = orgItemHandlers("offices");
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
