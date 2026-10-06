import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import CompletionThreshold from "@/components/CompletionThreshold";

function ThresholdControl() {
  const [threshold, setThreshold] = useState(0.7);
  return (
    <>
      <CompletionThreshold threshold={threshold} swarmSize={100} onChange={setThreshold} />
      <span data-testid="saved-threshold">{threshold}</span>
    </>
  );
}

it("offers an accessible whole-percentage completion control and saves its exact fraction", () => {
  render(<ThresholdControl />);
  const slider = screen.getByRole("slider", { name: /^Completion threshold$/ });
  expect(slider).toHaveAttribute("min", "1");
  expect(slider).toHaveAttribute("max", "100");
  expect(slider).toHaveAttribute("step", "1");
  fireEvent.change(slider, { target: { value: "7" } });
  expect(slider).toHaveValue("7");
  expect(slider).toHaveAttribute("aria-valuetext", "7%");
  expect(screen.getByText("7%")).toBeVisible();
  expect(screen.getByText("7 of 100 agents")).toBeVisible();
  expect(screen.getByTestId("saved-threshold")).toHaveTextContent("0.07");
});
