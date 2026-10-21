import { withApi } from "@/lib/api/with-api";

export const GET = withApi({ public: true }, async () => Response.json({ status: "ok" }));
