import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = createInterface({ input: process.stdin, terminal: false });
process.stdout.write('Ready for admin account details on stdin (input is hidden).\n');
const line = await new Promise((resolve, reject) => {
  input.once('line', resolve);
  input.once('close', () => reject(new Error('No account details received.')));
});
input.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();

let request;
let verification;
let accountCreated = false;
let roleAssigned = false;
try {
  request = JSON.parse(line);
  const email = String(request.email || '').trim().toLowerCase();
  const password = request.password;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!email || typeof password !== 'string' || !password || !url || !secret || !publishable) {
    throw new Error('Missing account details or server configuration.');
  }
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
  };
  const admin = createClient(url, secret, options);
  const creation = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let user = creation.data.user;
  if (creation.error) {
    const duplicate = ['email_exists', 'user_already_exists', 'email_address_exists'].includes(creation.error.code)
      || /already.*(?:registered|exists)/i.test(creation.error.message);
    if (!duplicate) throw creation.error;
    // Only the explicitly requested email is selected; other users are never logged.
    for (let page = 1; !user && page <= 1000; page += 1) {
      const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (result.error) throw result.error;
      user = result.data.users.find(candidate => candidate.email?.toLowerCase() === email);
      if (result.data.users.length < 100) break;
    }
    if (!user) throw new Error('The requested existing account could not be located.');
    const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (updated.error) throw updated.error;
    user = updated.data.user;
  } else {
    accountCreated = true;
  }
  if (!user?.id) throw new Error('Authentication did not return a user ID.');
  const promotion = await admin.from('profiles').update({ role: 'admin' }).eq('id', user.id).select('id,role').maybeSingle();
  if (promotion.error) throw promotion.error;
  let profile = promotion.data;
  if (!profile) {
    const inserted = await admin.from('profiles').insert({ id: user.id, role: 'admin' }).select('id,role').single();
    if (inserted.error) throw inserted.error;
    profile = inserted.data;
  }
  if (profile.role !== 'admin') throw new Error('Admin role verification failed.');
  roleAssigned = true;
  verification = createClient(url, publishable, options);
  const login = await verification.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const access = await verification.rpc('is_admin');
  if (access.error) throw access.error;
  if (access.data !== true) throw new Error('The signed-in account does not have admin access.');
  const orders = await verification.from('orders').select('id', { head: true, count: 'exact' });
  if (orders.error) throw orders.error;
  console.log(JSON.stringify({ email, accountCreated, emailConfirmed: Boolean(user.email_confirmed_at), role: 'admin', passwordLoginVerified: true, adminPermissionVerified: true, ordersAccessVerified: true, dashboard: 'http://127.0.0.1:5173/admin' }));
} catch (error) {
  const redact = value => {
    let text = String(value || 'Admin setup failed.');
    for (const sensitive of [request?.password, process.env.SUPABASE_SECRET_KEY]) {
      if (sensitive) text = text.split(sensitive).join('[redacted]');
    }
    return text;
  };
  console.error(JSON.stringify({ email: request?.email, accountCreated, roleAssigned, error: redact(error.message), code: error.code }));
  process.exitCode = 1;
} finally {
  if (verification) await verification.auth.signOut({ scope: 'local' }).catch(() => {});
  if (request) request.password = undefined;
}
