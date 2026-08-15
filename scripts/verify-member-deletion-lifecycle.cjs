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
async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data;
}
async function createDue(client, { name, phone, amount, month, year, status = 'pending', paymentAmount = 0, paymentDate = null, paymentMethod = 'cash', voucher = null }) {
  return rpc(client, 'create_member_dues', {
    p_name: name, p_phone: phone, p_amount: amount, p_month: month, p_year: year,
    p_all_months: false, p_initial_status: status, p_payment_amount: paymentAmount,
    p_payment_date: paymentDate, p_payment_method: paymentMethod, p_voucher_number: voucher,
    p_hold: false, p_notes: 'Automated deletion lifecycle verification',
  });
}
async function summary(client, month, year) { return rpc(client, 'get_accounting_summary', { p_month: month, p_year: year }); }
async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'client', '.env'));
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `deleteqa${suffix}`;
  const email = `${username}@masjid.local`;
  const password = 'DeleteQa!2026secure';
  const year = 2030;
  const name = `Affan Delete QA ${suffix}`;
  const phone = `902${suffix.slice(-7)}`;
  const { error: signupError } = await client.auth.signUp({ email, password, options: { data: { username } } });
  if (signupError) throw signupError;
  const { error: signinError } = await client.auth.signInWithPassword({ email, password });
  if (signinError) throw signinError;
  await rpc(client, 'claim_active_session', { p_take_over: false, p_device_label: 'Deletion lifecycle verification' });

  // Tests 1 and 2: paid September record appears in real money totals then vanishes completely on deletion.
  const initial = await createDue(client, { name, phone, amount: 500, month: 9, year, status: 'paid', paymentAmount: 500, paymentDate: `${year}-09-15`, paymentMethod: 'cash', voucher: `DELETE-OLD-${suffix}` });
  const initialDueId = initial.created_due_ids[0];
  let september = await summary(client, 9, year);
  assert(Number(september.monthly_collection) === 500 && Number(september.cash_received) === 500 && Number(september.yearly_collection) === 500, 'Initial paid September record did not enter monthly, yearly, and cash totals.');
  await rpc(client, 'delete_monthly_due', { p_due_member_id: initialDueId });
  const afterFirstDelete = await summary(client, 9, year);
  assert(Number(afterFirstDelete.monthly_collection) === 0 && Number(afterFirstDelete.cash_received) === 0 && Number(afterFirstDelete.yearly_collection) === 0, 'Deleting an isolated paid due left a ghost amount in accounting totals.');
  const visibleAfterDelete = await rpc(client, 'get_ledger_members', {});
  assert(!visibleAfterDelete.some((due) => due.id === initialDueId), 'Deleted monthly due remained visible.');
  const paymentsAfterDelete = await rpc(client, 'get_ledger_payments', {});
  assert(!paymentsAfterDelete.some((payment) => payment.voucher_number === `DELETE-OLD-${suffix}`), 'Payment tied only to deleted due was retained.');

  // Tests 3 and 4: same active period becomes available again, then genuine duplicate remains blocked.
  const replacement = await createDue(client, { name, phone, amount: 700, month: 9, year, status: 'paid', paymentAmount: 700, paymentDate: `${year}-09-16`, paymentMethod: 'account', voucher: `DELETE-NEW-${suffix}` });
  assert(Number(replacement.created_count) === 1, 'Re-creating the same member in the released month/year was blocked.');
  const replacementDueId = replacement.created_due_ids[0];
  september = await summary(client, 9, year);
  assert(Number(september.monthly_collection) === 700 && Number(september.account_received) === 700 && Number(september.cash_received) === 0, 'Replacement payment did not replace the deleted record cleanly.');
  const duplicate = await createDue(client, { name, phone, amount: 700, month: 9, year, status: 'pending' });
  assert(Number(duplicate.created_count) === 0 && Number(duplicate.skipped_count) === 1, 'Genuine same-month duplicate protection was not retained.');

  // Test 5: deleting September preserves August and October of the same stable person.
  const august = await createDue(client, { name, phone, amount: 500, month: 8, year, status: 'paid', paymentAmount: 500, paymentDate: `${year}-08-15`, paymentMethod: 'cash', voucher: `DELETE-AUG-${suffix}` });
  const october = await createDue(client, { name, phone, amount: 800, month: 10, year, status: 'paid', paymentAmount: 800, paymentDate: `${year}-10-15`, paymentMethod: 'cash', voucher: `DELETE-OCT-${suffix}` });
  assert(Number(august.created_count) === 1 && Number(october.created_count) === 1, 'Adjacent monthly records could not be created.');
  await rpc(client, 'delete_monthly_due', { p_due_member_id: replacementDueId });
  const augustSummary = await summary(client, 8, year);
  const septemberFinal = await summary(client, 9, year);
  const octoberSummary = await summary(client, 10, year);
  const yearlyAfterPeriodDelete = await summary(client, null, year);
  assert(Number(augustSummary.monthly_collection) === 500 && Number(octoberSummary.monthly_collection) === 800, 'Deleting September changed an unrelated month.');
  assert(Number(septemberFinal.monthly_collection) === 0 && Number(septemberFinal.account_received) === 0, 'Deleted September replacement still contributes to totals.');
  assert(Number(yearlyAfterPeriodDelete.yearly_collection) === 1300, 'Yearly total retained deleted September money or lost an unrelated month.');

  // Shared payment: one payment allocated across November and December retains only the December allocation after November is removed.
  const sharedName = `Shared Delete QA ${suffix}`;
  const sharedPhone = `903${suffix.slice(-7)}`;
  const november = await createDue(client, { name: sharedName, phone: sharedPhone, amount: 500, month: 11, year });
  const december = await createDue(client, { name: sharedName, phone: sharedPhone, amount: 500, month: 12, year });
  const novemberDueId = november.created_due_ids[0];
  const decemberDueId = december.created_due_ids[0];
  const sharedPayment = await rpc(client, 'record_member_payment', { p_due_member_id: novemberDueId, p_amount: 1000, p_payment_date: `${year}-11-20`, p_payment_method: 'cash', p_voucher_number: `DELETE-SHARED-${suffix}`, p_notes: 'shared allocation deletion QA', p_allocations: [{ monthly_due_id: novemberDueId, allocated_amount: 500 }, { monthly_due_id: decemberDueId, allocated_amount: 500 }] });
  assert(sharedPayment.allocations.length === 2, 'Shared allocation payment was not created.');
  await rpc(client, 'delete_monthly_due', { p_due_member_id: novemberDueId });
  const novemberAfterSharedDelete = await summary(client, 11, year);
  const decemberAfterSharedDelete = await summary(client, 12, year);
  const paymentsAfterSharedDelete = await rpc(client, 'get_ledger_payments', {});
  const survivingSharedPayment = paymentsAfterSharedDelete.find((payment) => payment.voucher_number === `DELETE-SHARED-${suffix}`);
  assert(Number(novemberAfterSharedDelete.monthly_collection) === 500, 'The surviving shared payment was not retained in its actual November payment-date total.');
  assert(Number(decemberAfterSharedDelete.monthly_collection) === 0, 'Shared payment date leaked into December collection-date totals.');
  assert(survivingSharedPayment && Number(survivingSharedPayment.amount) === 500 && survivingSharedPayment.allocations.length === 1 && survivingSharedPayment.allocations[0].monthly_due_id === decemberDueId, 'Shared payment was not reconciled to its surviving allocation.');

  console.log(JSON.stringify({ verified: true, username, isolatedPaymentDeletion: { initialMonthly: 500, afterDelete: 0, replacementMonthly: 700 }, multiMonth: { august: augustSummary.monthly_collection, september: septemberFinal.monthly_collection, october: octoberSummary.monthly_collection, yearly: yearlyAfterPeriodDelete.yearly_collection }, sharedPayment: { survivingAmount: survivingSharedPayment.amount, allocations: survivingSharedPayment.allocations.length } }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
