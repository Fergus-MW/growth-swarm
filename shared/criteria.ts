import type { CompletionCriteria } from './types.ts';
const numeric = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)';
const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const patterns:Partial<Record<keyof CompletionCriteria,RegExp>>={
 minCompanies:new RegExp(`(?:at least\\s+)?${numeric}\\s+(?:(?:qualified|in-universe|non-excluded|eligible)\\s+)*companies`,'gi'),
 independentSources:new RegExp(`${numeric}\\s+independent\\s+(?:source\\s+)?origins`,'gi'),
 signalPercent:new RegExp(`${numeric}\\s*(?:%|percent)(?=[^.\\n]*(?:signal|dated))`,'gi'),
 saturationAttempts:new RegExp(`${numeric}\\s+(?:completed\\s+)?discovery attempts`,'gi'),
};
export function explicitCriteria(text:string):Partial<CompletionCriteria>{
 const result:Partial<CompletionCriteria>={};
 for(const [key,pattern] of Object.entries(patterns)){
  pattern.lastIndex=0;
  const values=[...text.matchAll(pattern)].map(m=>words[m[1].toLowerCase()]??Number(m[1]));
  if(values.length)(result as Record<string,unknown>)[key]=Math.max(...values);
 }
 if(/(?:every|each|all)[^.\n]*(?:founder|ceo)[^.\n]*(?:another|other|second)[^.\n]*contact/i.test(text))result.requireContacts=true;
 return result;
}
export function criteriaFromText(text: string): CompletionCriteria {
 return { text, minCompanies: 0, signalPercent: 0, requireContacts: false, independentSources: 1, saturationAttempts: 0, ...explicitCriteria(text) };
}
/** Editing a measurable control explicitly edits the corresponding recognized prose. */
export function rewriteCriteriaText(text:string,key:keyof CompletionCriteria,value:unknown):string{
 const pattern=patterns[key];if(!pattern)return text;
 pattern.lastIndex=0;
 return text.replace(pattern,(matched:string,number:string)=>matched.replace(number,String(value)));
}
export function criteriaConflicts(criteria:CompletionCriteria):string[]{
 const parsed=explicitCriteria(criteria.text);const issues:string[]=[];
 for(const key of ['minCompanies','signalPercent','independentSources','saturationAttempts'] as const)if(parsed[key]!==undefined && criteria[key]<parsed[key]!)issues.push(`${key} is ${criteria[key]}, but the written criteria require at least ${parsed[key]}. Review the interpretation before launch.`);
 if(parsed.requireContacts&&!criteria.requireContacts)issues.push('Written criteria require current leadership and another contact. Enable the contact rule or edit the written criteria.');
 return issues;
}
