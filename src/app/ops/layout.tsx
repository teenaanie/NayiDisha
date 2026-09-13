import {scopePage} from '@/lib/auth';
import {OpsShell} from './shell';
import './operations.css';
export default async function OperationsLayout({children}:{children:React.ReactNode}) {const viewer=await scopePage('ops');return <OpsShell role={viewer.role}>{children}</OpsShell>;}
