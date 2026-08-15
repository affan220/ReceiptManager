const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  const values = {};
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function firstFriday(year, month) {
  for (let day = 1; day <= 7; day += 1) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 5) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  throw new Error('Could not calculate a Friday.');
}
async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data;
}
async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'client', '.env'));
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `accountingqa${suffix}`;
  const email = `${username}@masjid.local`;
  const password = 'AccountingQa!2026secure';
  const { error: signupError } = await client.auth.signUp({ email, password, options: { data: { username } } });
  if (signupError) throw signupError;
  const { error: signinError } = await client.auth.signInWithPassword({ email, password });
  if (signinError) throw signinError;
  await rpc(client, 'claim_active_session', { p_take_over: false, p_device_label: 'Shared accounting verification' });

  const year = 2029;
  const augustDue = await rpc(client, 'create_member_dues', { p_name: `August QA ${suffix}`, p_phone: '9012345678', p_amount: 700, p_month: 8, p_year: year, p_all_months: false, p_initial_status: 'paid', p_payment_amount: 700, p_payment_date: `${year}-08-05`, p_payment_method: 'cash', p_voucher_number: `AUG-${suffix}`, p_hold: false, p_notes: '' });
  const septemberDue = await rpc(client, 'create_member_dues', { p_name: `September QA ${suffix}`, p_phone: '9012345679', p_amount: 500, p_month: 9, p_year: year, p_all_months: false, p_initial_status: 'paid', p_payment_amount: 500, p_payment_date: `${year}-09-05`, p_payment_method: 'account', p_voucher_number: `SEP-${suffix}`, p_hold: false, p_notes: '' });
  assert(augustDue.created_count === 1 && septemberDue.created_count === 1, 'Test member payments were not created.');

  await rpc(client, 'upsert_friday_collection', { p_collection_date: firstFriday(year, 8), p_amount: 17875, p_payment_mode: 'cash', p_notes: 'August accounting QA' });
  await rpc(client, 'create_room_rent', { p_rent_date: `${year}-08-15`, p_amount: 5000, p_payment_mode: 'account', p_notes: 'August accounting QA' });
  const septemberFriday = await rpc(client, 'upsert_friday_collection', { p_collection_date: firstFriday(year, 9), p_amount: 1000, p_payment_mode: 'cash', p_notes: 'September accounting QA' });
  await rpc(client, 'create_room_rent', { p_rent_date: `${year}-09-15`, p_amount: 2000, p_payment_mode: 'account', p_notes: 'September accounting QA' });

  const august = await rpc(client, 'get_accounting_summary', { p_month: 8, p_year: year });
  assert(Number(august.member_monthly_collection) === 700, `August member payment expected 700, received ${august.member_monthly_collection}.`);
  assert(Number(august.friday_collection) === 17875 && Number(august.room_rent_collection) === 5000, 'August Other breakdown is incorrect.');
  assert(Number(august.other_collection) === 22875, `August Other expected 22875, received ${august.other_collection}.`);
  assert(Number(august.monthly_collection) === 23575 && Number(august.total_collection) === 23575, 'August Monthly Collection double-counted or omitted income.');
  assert(Number(august.cash_received) === 18575 && Number(august.account_received) === 5000, 'August cash/account totals are incorrect.');

  const september = await rpc(client, 'get_accounting_summary', { p_month: 9, p_year: year });
  assert(Number(september.member_monthly_collection) === 500, 'September member payment is incorrect.');
  assert(Number(september.other_collection) === 3000 && Number(september.monthly_collection) === 3500, 'September totals leaked August records or double-counted income.');
  assert(Number(september.cash_received) === 1000 && Number(september.account_received) === 2500, 'September cash/account totals are incorrect.');

  const october = await rpc(client, 'get_accounting_summary', { p_month: 10, p_year: year });
  assert(Number(october.monthly_collection) === 0 && Number(october.other_collection) === 0, 'October included records from another month.');
  const augustAgain = await rpc(client, 'get_ledger_dashboard_summary', { p_month: 8, p_year: year });
  assert(Number(augustAgain.monthly_collection) === 23575 && Number(augustAgain.other_collection) === 22875, 'Dashboard summary contract diverged from accounting summary.');

  const yearSummary = await rpc(client, 'get_accounting_summary', { p_month: null, p_year: year });
  assert(Number(yearSummary.member_yearly_collection) === 1200, 'Yearly member payments are incorrect.');
  assert(Number(yearSummary.yearly_other_collection) === 25875 && Number(yearSummary.yearly_collection) === 27075, 'Yearly total did not include all Other income exactly once.');

  await rpc(client, 'delete_friday_collection', { p_collection_id: septemberFriday.id });
  const afterDelete = await rpc(client, 'get_accounting_summary', { p_month: 9, p_year: year });
  assert(Number(afterDelete.other_collection) === 2000 && Number(afterDelete.monthly_collection) === 2500 && Number(afterDelete.cash_received) === 0, 'Deleting a Friday did not immediately remove it from Other, Monthly, and cash totals.');
  await rpc(client, 'upsert_friday_collection', { p_collection_date: firstFriday(year, 9), p_amount: 1000, p_payment_mode: 'cash', p_notes: 'September accounting QA restored' });
  const restored = await rpc(client, 'get_accounting_summary', { p_month: 9, p_year: year });
  assert(Number(restored.monthly_collection) === 3500, 'Restoring a Friday did not refresh the database-driven monthly total.');

  console.log(JSON.stringify({ verified: true, username, august: { member: august.member_monthly_collection, friday: august.friday_collection, rent: august.room_rent_collection, other: august.other_collection, monthly: august.monthly_collection, cash: august.cash_received, account: august.account_received }, september: { member: september.member_monthly_collection, other: september.other_collection, monthly: september.monthly_collection, cash: september.cash_received, account: september.account_received }, octoberMonthly: october.monthly_collection, yearly: { member: yearSummary.member_yearly_collection, other: yearSummary.yearly_other_collection, total: yearSummary.yearly_collection }, afterDeleteMonthly: afterDelete.monthly_collection }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
