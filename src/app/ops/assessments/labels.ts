/** Assessment session states, in words for operators. */
export const STATE:Record<string,{label:string;tone:'ok'|'warn'|'bad'|'mute'}>={
 active:{label:'in progress',tone:'mute'},completed:{label:'scoring',tone:'mute'},evaluating:{label:'scoring',tone:'mute'},
 reported:{label:'scored',tone:'ok'},review_required:{label:'under review',tone:'warn'},evaluation_failed:{label:'scoring failed',tone:'bad'},abandoned:{label:'abandoned',tone:'mute'},
};
