import { scenario } from "./runtime";
import { gtmDemoSearch } from "./gtm-demo";
export const webSearchAvailable = () => true;
export async function webSearch(query = "") {
  if (scenario === "gtm-demo") return gtmDemoSearch(query);
  return {
    ok: true,
    items: [
      {
        title: "FICTIONAL volcano research source",
        url: "https://fixture.invalid/volcano",
        content: "FICTIONAL: Ash and lava are volcanic hazards in this synthetic source.",
        publishedDate: "2026-01-01",
      },
    ],
  };
}
