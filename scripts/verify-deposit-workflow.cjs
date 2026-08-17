const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  const values = {};
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function same(actual, expected, message) { assert(Math.abs(Number(actual) - expected) < 0.001, `${message}; expected ${expected}, received ${actual}.`); }
async function rpc(client, name, params) { const { data, error } = await client.rpc(name, params); if (error) throw error; return data; }
async function createPaidDue(client, { name, phone, amount, method, date, voucher, month, year }) {
  return rpc(client, 'create_member_dues', { p_name: name, p_phone: phone, p_amount: amount, p_month: month, p_year: year, p_all_months: false, p_initial_status: 'paid', p_payment_amount: amount, p_payment_date: date, p_payment_method: method, p_voucher_number: voucher, p_hold: false, p_notes: 'Automated Deposit verification' });
}
async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'client', '.env'));
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `depositqa${suffix}`;
  const password = 'DepositQa!2026secure';
  const email = `${username}@masjid.local`;
  const month = 8;
  const year = 2031;
  const { error: signupError } = await client.auth.signUp({ email, password, options: { data: { username } } });
  if (signupError) throw signupError;
  const { error: signinError } = await client.auth.signInWithPassword({ email, password });
  if (signinError) throw signinError;
  await rpc(client, 'claim_active_session', { p_take_over: false, p_device_label: 'Deposit workflow verification' });

  await createPaidDue(client, { name: `Deposit Cash ${suffix}`, phone: `901${suffix.slice(-7)}`, amount: 10000, method: 'cash', date: `${year}-08-15`, voucher: `DEP-CASH-${suffix}`, month, year });
  await createPaidDue(client, { name: `Deposit Account ${suffix}`, phone: `902${suffix.slice(-7)}`, amount: 5000, method: 'account', date: `${year}-08-15`, voucher: `DEP-ACCOUNT-${suffix}`, month, year });
  await rpc(client, 'create_room_rent', { p_rent_date: `${year}-08-02`, p_amount: 5000, p_payment_mode: 'cash', p_notes: 'Deposit cash verification' });
  await rpc(client, 'create_room_rent', { p_rent_date: `${year}-08-03`, p_amount: 2000, p_payment_mode: 'account', p_notes: 'Deposit account verification' });

  const before = await rpc(client, 'get_accounting_summary', { p_month: month, p_year: year });
  same(before.monthly_collection, 22000, 'Baseline monthly income must include only real member and Other collections');
  same(before.yearly_collection, 22000, 'Baseline yearly income must equal real collection total');
  same(before.cash_received, 15000, 'Baseline cash income is incorrect');
  same(before.account_received, 7000, 'Baseline account income is incorrect');

  const deposit = await rpc(client, 'create_deposit', { p_month: month, p_year: year, p_deposit_date: `${year}-08-15`, p_amount: 8000, p_notes: 'Automated cash to account transfer' });
  const afterCreate = await rpc(client, 'get_accounting_summary', { p_month: month, p_year: year });
  const depositSummary = await rpc(client, 'get_deposit_summary', { p_month: month, p_year: year });
  same(afterCreate.monthly_collection, 22000, 'Deposit incorrectly changed monthly collection');
  same(afterCreate.yearly_collection, 22000, 'Deposit incorrectly changed yearly collection');
  same(afterCreate.cash_received, 7000, 'Deposit did not reduce available cash');
  same(afterCreate.account_received, 15000, 'Deposit did not increase account balance');
  same(Number(afterCreate.cash_received) + Number(afterCreate.account_received), 22000, 'Deposit changed total money across cash and account');
  same(depositSummary.total_deposited, 8000, 'Deposit history total is incorrect');
  same(depositSummary.available_cash, 7000, 'Available cash after deposit is incorrect');
  assert(depositSummary.deposits.length === 1 && depositSummary.deposits[0].deposit_date === `${year}-08-15`, 'Deposit date/history was not stored correctly.');

  let insufficientBlocked = false;
  try { await rpc(client, 'create_deposit', { p_month: month, p_year: year, p_deposit_date: `${year}-08-16`, p_amount: 8000, p_notes: 'Should fail' }); }
  catch (error) { insufficientBlocked = String(error.message ?? error).toLowerCase().includes('insufficient cash balance'); }
  assert(insufficientBlocked, 'Deposit larger than available cash was not blocked.');

  await rpc(client, 'update_deposit', { p_deposit_id: deposit.id, p_month: month, p_year: year, p_deposit_date: `${year}-08-16`, p_amount: 6000, p_notes: 'Updated automated transfer' });
  const afterEdit = await rpc(client, 'get_accounting_summary', { p_month: month, p_year: year });
  const afterEditDepositSummary = await rpc(client, 'get_deposit_summary', { p_month: month, p_year: year });
  same(afterEdit.monthly_collection, 22000, 'Editing deposit changed monthly collection');
  same(afterEdit.cash_received, 9000, 'Editing deposit did not restore cash correctly');
  same(afterEdit.account_received, 13000, 'Editing deposit did not reduce account correctly');
  same(afterEditDepositSummary.available_cash, 9000, 'Available cash after deposit edit is incorrect');

  await createPaidDue(client, { name: `Deposit September ${suffix}`, phone: `903${suffix.slice(-7)}`, amount: 3000, method: 'cash', date: `${year}-09-10`, voucher: `DEP-SEP-${suffix}`, month: 9, year });
  const september = await rpc(client, 'get_accounting_summary', { p_month: 9, p_year: year });
  const septemberDeposits = await rpc(client, 'get_deposit_summary', { p_month: 9, p_year: year });
  same(september.monthly_collection, 3000, 'Deposit from August leaked into September collection');
  same(september.cash_received, 3000, 'Deposit from August leaked into September cash balance');
  same(september.account_received, 0, 'Deposit from August leaked into September account balance');
  same(septemberDeposits.total_deposited, 0, 'Deposit history mixed periods.');

  await rpc(client, 'delete_deposit', { p_deposit_id: deposit.id });
  const afterDelete = await rpc(client, 'get_accounting_summary', { p_month: month, p_year: year });
  const afterDeleteDepositSummary = await rpc(client, 'get_deposit_summary', { p_month: month, p_year: year });
  same(afterDelete.monthly_collection, 22000, 'Deleting deposit changed monthly collection');
  same(afterDelete.yearly_collection, 25000, 'Deleting deposit changed yearly income rather than only cash/account distribution');
  same(afterDelete.cash_received, 15000, 'Deleting deposit did not restore cash');
  same(afterDelete.account_received, 7000, 'Deleting deposit did not restore account balance');
  same(afterDeleteDepositSummary.total_deposited, 0, 'Deleting deposit left a ghost transfer.');

  const otherClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const otherUsername = `depositisolated${suffix}`;
  const { error: otherSignupError } = await otherClient.auth.signUp({ email: `${otherUsername}@masjid.local`, password, options: { data: { username: otherUsername } } });
  if (otherSignupError) throw otherSignupError;
  const { error: otherSigninError } = await otherClient.auth.signInWithPassword({ email: `${otherUsername}@masjid.local`, password });
  if (otherSigninError) throw otherSigninError;
  await rpc(otherClient, 'claim_active_session', { p_take_over: false, p_device_label: 'Deposit isolation verification' });
  const isolated = await rpc(otherClient, 'get_deposit_summary', { p_month: month, p_year: year });
  assert(isolated.deposits.length === 0 && Number(isolated.total_deposited) === 0 && Number(isolated.available_cash) === 0, 'Another account can see deposit data or cash availability.');

  console.log(JSON.stringify({ verified: true, username, baseline: { cash: 15000, account: 7000, collection: 22000 }, afterDeposit: { cash: 7000, account: 15000, collection: 22000 }, afterEdit: { cash: 9000, account: 13000 }, afterDelete: { cash: 15000, account: 7000, yearly: 25000 }, insufficientDepositBlocked: insufficientBlocked, isolatedAccountDepositCount: isolated.deposits.length }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
