export const RUN_STATUS:Record<string,{label:string;tone:'ok'|'warn'|'bad'|'info'|'mute'}>={
 analysing:{label:'Analysing',tone:'info'},in_review:{label:'Waiting for review',tone:'warn'},approved:{label:'Approved',tone:'ok'},failed:{label:'Failed',tone:'bad'},
};
export const SEVERITY_TONE:Record<string,'bad'|'warn'|'mute'>={high:'bad',medium:'warn',low:'mute'};
