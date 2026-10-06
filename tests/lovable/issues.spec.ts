import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue();
    return route.abort("blockedbyclient");
  });
});

test("real route admits one run on rapid Start and persists generated criteria", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/setup");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  await page.getByRole("button", { name: "Start", exact: true }).click({ clickCount: 2 });
  await expect(page).toHaveURL(/\/runs\/fixture-runs-/);
  const rows = await page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureDatabase: { tables: { runs: Array<Record<string, unknown>> } };
        }
      ).fixtureDatabase.tables.runs,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.completion_criteria).toContain("Explain fictional volcano hazards");
  expect(rows[0]?.completion_criteria).not.toBe("");
  expect(["running", "completed"]).toContain(rows[0]?.status);
  expect(errors).toEqual([]);
});

test("keyboard threshold preserves seven percent and 100 panels on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  const threshold = page.getByRole("slider", { name: "Completion threshold", exact: true });
  await threshold.focus();
  await threshold.press("Home");
  for (let i = 0; i < 6; i++) await threshold.press("ArrowRight");
  await expect(threshold).toHaveValue("7");
  await page.locator("summary", { hasText: "Advanced settings" }).click();
  const swarm = page.getByRole("slider", { name: /Swarm size/ });
  await swarm.focus();
  await swarm.press("End");
  await expect(page.getByText("7 of 100 agents", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/fixture-runs-/);
  const config = await page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureDatabase: { tables: { runs: Array<Record<string, unknown>> } };
        }
      ).fixtureDatabase.tables.runs[0],
  );
  expect(config?.threshold).toBe(0.07);
  expect(config?.swarm_size).toBe(100);
  await expect(page.getByRole("article", { name: /^Agent / })).toHaveCount(100);
  const last = page.getByRole("article", { name: "Agent 100", exact: true });
  await last.scrollIntoViewIfNeeded();
  await last.locator("summary", { hasText: "Decision explanations" }).click();
  await expect(
    last
      .getByText("Fixture evaluator agrees with the synthetic captured evidence", { exact: true })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
});

test("generic task reaches Completed with stored evidence and history", async ({ page }) => {
  await page.goto("/setup");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                fixtureDatabase: { tables: { runs: Array<{ outcome: string }> } };
              }
            ).fixtureDatabase.tables.runs[0]?.outcome,
        ),
      { timeout: 5000 },
    )
    .toBe("consensus");
  await expect(page.getByRole("banner").getByText("Completed", { exact: true })).toBeVisible();
  const graph = page.getByRole("img", { name: /^Research graph with/ });
  await expect(graph).toHaveAccessibleName("Research graph with 2 objects");
  await expect(graph.locator("canvas")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  const tables = await page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureDatabase: { tables: Record<string, Array<Record<string, unknown>>> };
        }
      ).fixtureDatabase.tables,
  );
  expect(tables.runs?.[0]?.outcome).toBe("consensus");
  expect(tables.nodes?.some((node) => node.category === "source_chunk")).toBeTruthy();
  expect(tables.nodes?.some((node) => node.category === "note")).toBeTruthy();
  expect(tables.checkpoints?.length).toBeGreaterThan(0);
  expect(tables.votes?.length).toBe(20);
  const firstAgent = page.getByRole("article", { name: "Agent 01", exact: true });
  await firstAgent.locator("summary", { hasText: "Actions & results" }).click();
  await firstAgent.getByRole("button", { name: "Inspect source", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Research inspector", exact: true })).toContainText(
    "FICTIONAL",
  );
  await page.getByRole("button", { name: "Close research inspector", exact: true }).click();
  await page.screenshot({ path: "test-results/lovable-completed-desktop.png" });
  await page
    .getByRole("link", { name: /^RUNS$/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Research runs", exact: true })).toBeVisible();
  await expect(
    page.getByText("Explain fictional volcano hazards using captured sources", { exact: true }),
  ).toBeVisible();
});

test("failed agent evaluations remain Failed with saved failure traces", async ({ page }) => {
  await page.goto("/setup?fixture=voter-error");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("banner").getByText("Failed", { exact: true })).toBeVisible();
  const agent = page.getByRole("article", { name: "Agent 01", exact: true });
  await agent.locator("summary", { hasText: "Trace history" }).click();
  await expect(
    agent
      .getByText("The action failed. Recorded source details remain in the source ledger.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
});

test("manual Stop preserves the actual run and its partial checkpoint", async ({ page }) => {
  await page.goto("/setup?fixture=slow");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("banner").getByText("Stopped by you", { exact: true })).toBeVisible();
  const saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureDatabase: { tables: { runs: Array<{ outcome: string }>; checkpoints: unknown[] } };
        }
      ).fixtureDatabase.tables,
  );
  expect(saved.runs[0]?.outcome).toBe("stopped_by_user");
  expect(saved.checkpoints.length).toBeGreaterThan(0);
});

test("disabled connector records honest gaps without invoking web search", async ({ page }) => {
  await page.goto("/setup");
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("Explain fictional volcano hazards using captured sources");
  await page.locator("summary", { hasText: "Advanced settings" }).click();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    page.getByRole("banner").getByText("Criteria unmet — gaps stay visible", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureDatabase: {
            tables: { nodes: Array<{ category: string }>; invocations: unknown[] };
          };
        }
      ).fixtureDatabase.tables,
  );
  expect(saved.invocations).toHaveLength(0);
  expect(saved.nodes.filter((node) => node.category === "source_chunk")).toHaveLength(0);
  expect(saved.nodes.some((node) => node.category === "note")).toBeTruthy();
});

test("agent 100 can browse an earliest saved action beyond its live buffer", async ({ page }) => {
  await page.goto("/runs/fixture-archive?fixture=archive");
  const last = page.getByRole("article", { name: "Agent 100", exact: true });
  await expect(last.locator("summary", { hasText: "Trace history (100)" })).toBeVisible();
  await last.getByRole("button", { name: "Browse older saved history", exact: true }).click();
  await expect(last.getByText("Saved history page · 25 entries", { exact: true })).toBeVisible();
  await last.locator("summary", { hasText: "Trace history" }).click();
  await expect(last.getByText("Saved fictional action 1", { exact: true })).toBeVisible();
  await last.getByRole("button", { name: "Latest activity", exact: true }).click();
  await expect(last.getByText("Saved fictional action 125", { exact: true }).first()).toBeVisible();
});
