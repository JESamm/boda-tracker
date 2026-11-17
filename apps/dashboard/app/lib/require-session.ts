import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function requireDashboardSession() {
  const cookieStore = await cookies();
  if (!cookieStore.has('boda_access') && !cookieStore.has('boda_refresh')) {
    redirect('/login');
  }
}
