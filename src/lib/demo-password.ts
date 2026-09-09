import {randomBytes,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function hashPassword(password:string){
 if(password.length<10||password.length>128)throw new Error('Use a demo password between 10 and 128 characters.');
 const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64) as Buffer;
 return salt+':'+key.toString('hex');
}
export async function checkPassword(password:string,stored:string){
 if(password.length>128)return false;
 const [salt,hex]=stored.split(':');if(!salt||!hex||hex.length!==128)return false;
 const key=await scrypt(password,salt,64) as Buffer;return timingSafeEqual(key,Buffer.from(hex,'hex'));
}
