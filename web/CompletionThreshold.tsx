import { requiredAgreement } from '../shared/consensus';

export default function CompletionThreshold({threshold,swarmSize,onChange,disabled=false}:{threshold:number;swarmSize:number;onChange:(threshold:number)=>void;disabled?:boolean}) {
  const percentage=Math.round(threshold*100);
  return <div className="field">
    <label htmlFor="threshold">Completion threshold<output htmlFor="threshold" className="range-number" aria-hidden="true">{percentage}%</output></label>
    <input id="threshold" type="range" min="1" max="100" step="1" value={percentage} onChange={event=>onChange(Number(event.target.value)/100)} disabled={disabled} aria-valuetext={`${percentage}%`} aria-describedby="threshold-help"/>
    <div className="range-labels" aria-hidden="true"><span>1%</span><span>100%</span></div>
    <p id="threshold-help" className="field-help">At least <strong>{requiredAgreement(swarmSize,threshold)} of {swarmSize} agents</strong> must agree that the completion criteria are met on the same graph revision. The required number of agents is rounded up.</p>
  </div>;
}
