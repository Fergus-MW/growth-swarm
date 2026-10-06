export const webSearchAvailable = () => true;
export async function webSearch() {
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
