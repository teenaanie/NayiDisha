import {RuleBasedInterpreter} from '@/modules/adapters/voice';
const I=new RuleBasedInterpreter();
const ctx={localities:[{key:'aundh',display_name:'Aundh'},{key:'baner',display_name:'Baner'},{key:'kothrud',display_name:'Kothrud'},{key:'shivajinagar',display_name:'Shivajinagar'},{key:'viman_nagar',display_name:'Viman Nagar'},{key:'hadapsar',display_name:'Hadapsar'}],
 shifts:['ANY','09:30-18:30','ROTATIONAL_DAYTIME','10:00-19:00','09:00-18:00']};
const cases:[string,string,'en'|'hi'|'mr'][]=[
 ['name','My name is Sunita Shinde','en'],['name','मेरा नाम सुनीता शिंदे है','hi'],['name','माझं नाव सुनीता शिंदे आहे','mr'],
 ['locality','I live in Aundh','en'],['locality','मैं औंध में रहती हूँ','hi'],['locality','Viman Nagar','en'],
 ['experienceMonths','I have two years experience','en'],['experienceMonths','eighteen months','en'],['experienceMonths','मुझे दो साल का अनुभव है','hi'],['experienceMonths','I am a fresher','en'],
 ['skills','Field sales and customer service','en'],['skills','cashier, customer handling and billing','en'],
 ['expectedPay','eighteen thousand','en'],['expectedPay','18 thousand','en'],['expectedPay','18000','en'],['expectedPay','अठारह हज़ार','hi'],['expectedPay','twenty five thousand','en'],['expectedPay','thirty thousand','en'],['expectedPay','बीस हज़ार','hi'],
 ['commute','45 minutes','en'],['commute','one hour','en'],['commute','तीस मिनट','hi'],
 ['shifts','Any shift','en'],['shifts','कोई भी शिफ्ट','hi'],['shifts','day shift','en'],
 ['confirm','yes correct','en'],['confirm','हाँ सही है','hi'],['confirm','no','en'],['confirm','नाही','mr'],['shifts','कोणतीही शिफ्ट','mr'],['locality','माझं घर कोथरूड आहे','mr'],
];
(async()=>{let bad=0;
for(const [f,t,l] of cases){const r=await I.interpret(f as any,t,l,ctx);
 const ok=r.value!==null; if(!ok)bad++;
 console.log(`${ok?'OK ':'FAIL'} ${f.padEnd(17)} "${t}" -> ${JSON.stringify(r.value)} (${r.confidence})`);}
console.log(bad?`\n${bad} FAILED`:'\nall parsed');})();
