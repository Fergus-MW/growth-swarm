import { useId } from "react";
import { requiredAgreement } from "../../shared/consensus";

type CompletionThresholdProps = {
  threshold: number;
  swarmSize: number;
  onChange: (threshold: number) => void;
  disabled?: boolean;
};

export default function CompletionThreshold({
  threshold,
  swarmSize,
  onChange,
  disabled = false,
}: CompletionThresholdProps) {
  const id = useId();
  const percentage = Math.round(threshold * 100);
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Completion threshold
        </label>
        <output htmlFor={id} className="font-data text-sm text-primary" aria-hidden="true">
          {percentage}%
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={100}
        step={1}
        value={percentage}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        disabled={disabled}
        aria-valuetext={`${percentage}%`}
        aria-describedby={`${id}-help`}
        className="w-full accent-[oklch(0.82_0.14_185)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50"
      />
      <div
        className="flex justify-between font-data text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span>1%</span>
        <span>100%</span>
      </div>
      <p id={`${id}-help`} className="mt-2 text-xs leading-relaxed text-muted-foreground">
        At least{" "}
        <strong className="text-primary">
          {requiredAgreement(swarmSize, threshold)} of {swarmSize} agents
        </strong>{" "}
        must agree that the completion criteria are met on the same graph revision. The required
        number of agents is rounded up.
      </p>
    </div>
  );
}
