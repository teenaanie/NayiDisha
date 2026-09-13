import {scopePage} from '@/lib/auth';
export default async function OperationsLayout({children}:{children:React.ReactNode}) {await scopePage('ops');return <>{children}</>;}
