export const SIM_STATUS:Record<string,{label:string;tone:'ok'|'warn'|'bad'|'info'|'mute'}>={
 running:{label:'Running',tone:'info'},completed:{label:'Completed',tone:'ok'},failed:{label:'Failed',tone:'bad'},cancelled:{label:'Cancelled',tone:'mute'},
};
export const STEP_STATUS:Record<string,{label:string;tone:'ok'|'warn'|'bad'|'info'|'mute'}>={
 pending:{label:'Waiting',tone:'mute'},talking:{label:'Talking',tone:'info'},scoring:{label:'Being assessed',tone:'info'},done:{label:'Done',tone:'ok'},failed:{label:'Failed',tone:'bad'},
};
