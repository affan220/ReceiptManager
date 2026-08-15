const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  const values = {};
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    values[line.slice(0, index)] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function createTestClient(env, suffix, device) {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const username = `otherqa${suffix}`;
  const email = `${username}@masjid.local`;
  const password = 'OtherQa!2026secure';
  const { error: registerError } = await client.auth.signUp({ email, password, options: { data: { username } } });
  if (registerError) throw registerError;
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  const { error: sessionError } = await client.rpc('claim_active_session', { p_take_over: false, p_device_label: device });
  if (sessionError) throw sessionError;
  return { client, username };
}
async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'client', '.env'));
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { client, username } = await createTestClient(env, suffix, 'Other income verification');
  const period = { month: 9, year: 2028 };
  const fridayRows = [
    ['2028-09-01', 1000, 'cash'], ['2028-09-08', 1500, 'account'], ['2028-09-15', 1200, 'cash'], ['2028-09-22', 1300, 'cash'], ['2028-09-29', 900, 'account'],
  ];
  for (const [date, amount, mode] of fridayRows) {
    const { error } = await client.rpc('upsert_friday_collection', { p_collection_date: date, p_amount: amount, p_payment_mode: mode, p_notes: 'QA Friday collection' });
    if (error) throw error;
  }
  const { error: updateFridayError } = await client.rpc('upsert_friday_collection', { p_collection_date: '2028-09-01', p_amount: 1000, p_payment_mode: 'cash', p_notes: 'Edited QA Friday collection' });
  if (updateFridayError) throw updateFridayError;
  const { error: firstRentError } = await client.rpc('create_room_rent', { p_rent_date: '2028-09-05', p_amount: 5000, p_payment_mode: 'cash', p_notes: 'QA first rent' });
  if (firstRentError) throw firstRentError;
  const { data: secondRent, error: secondRentError } = await client.rpc('create_room_rent', { p_rent_date: '2028-09-20', p_amount: 7000, p_payment_mode: 'account', p_notes: 'QA second rent' });
  if (secondRentError) throw secondRentError;
  const { error: updateRentError } = await client.rpc('update_room_rent', { p_rent_id: secondRent.id, p_rent_date: '2028-09-20', p_amount: 7000, p_payment_mode: 'account', p_notes: 'Edited QA second rent' });
  if (updateRentError) throw updateRentError;
  const { data: other, error: otherError } = await client.rpc('get_other_income', { p_month: period.month, p_year: period.year });
  if (otherError) throw otherError;
  assert(other.friday_collections.length === 5, `Expected 5 September Fridays; received ${other.friday_collections.length}.`);
  assert(Number(other.friday_total) === 5900, `Expected Friday total 5900; received ${other.friday_total}.`);
  assert(other.room_rents.length === 2 && Number(other.room_rent_total) === 12000, 'Room-rent totals were not preserved.');
  assert(Number(other.other_total) === 17900, `Expected Other total 17900; received ${other.other_total}.`);
  assert(Number(other.cash_total) === 8500 && Number(other.account_total) === 9400, 'Cash/account totals are incorrect.');
  const { data: dashboard, error: dashboardError } = await client.rpc('get_ledger_dashboard_summary', { p_month: period.month, p_year: period.year });
  if (dashboardError) throw dashboardError;
  assert(Number(dashboard.friday_collection) === 5900, 'Dashboard did not include Friday total.');
  assert(Number(dashboard.room_rent_collection) === 12000, 'Dashboard did not include room-rent total.');
  assert(Number(dashboard.other_collection) === 17900 && Number(dashboard.total_collection) === 17900, 'Dashboard Other/overall totals are incorrect.');
  const { data: membersBeforePhone, error: membersBeforePhoneError } = await client.rpc('get_ledger_members');
  if (membersBeforePhoneError) throw membersBeforePhoneError;
  const phoneName = `Phone QA ${suffix}`;
  const { data: phoneCreate, error: phoneCreateError } = await client.rpc('create_member_dues', {
    p_name: phoneName, p_phone: '9876543210', p_amount: 250, p_month: 1, p_year: 2029, p_all_months: false, p_initial_status: 'unpaid', p_payment_amount: 0, p_payment_date: null, p_payment_method: 'cash', p_voucher_number: null, p_hold: false, p_notes: '',
  });
  if (phoneCreateError) throw phoneCreateError;
  const { data: phoneSecond, error: phoneSecondError } = await client.rpc('create_member_dues', {
    p_name: phoneName, p_phone: '+91 9876543210', p_amount: 250, p_month: 2, p_year: 2029, p_all_months: false, p_initial_status: 'unpaid', p_payment_amount: 0, p_payment_date: null, p_payment_method: 'cash', p_voucher_number: null, p_hold: false, p_notes: '',
  });
  if (phoneSecondError) throw phoneSecondError;
  assert(phoneCreate.member_identity_id === phoneSecond.member_identity_id, 'Normalized phone values did not reuse one member identity.');
  const { data: membersAfterPhone, error: membersAfterPhoneError } = await client.rpc('get_ledger_members');
  if (membersAfterPhoneError) throw membersAfterPhoneError;
  const phoneMember = membersAfterPhone.find((member) => member.name === phoneName && member.month === 1 && member.year === 2029);
  assert(phoneMember && phoneMember.phone === '+91 9876543210', `Expected normalized phone +91 9876543210; received ${phoneMember?.phone}.`);
  const { data: importResult, error: importError } = await client.rpc('bulk_import_members', { p_rows: [{ name: `Import Phone ${suffix}`, phone: '9123456789', amount: '100', status: 'unpaid', payment_mode: 'cash', month: '3', year: '2029', payment_date: '', voucher_number: '', payment_amount: '' }] });
  if (importError) throw importError;
  assert(Number(importResult.imported_count) === 1, 'Phone-normalized import did not create its valid row.');
  const { data: importedMembers, error: importedMembersError } = await client.rpc('get_ledger_members');
  if (importedMembersError) throw importedMembersError;
  const importedPhone = importedMembers.find((member) => member.name === `Import Phone ${suffix}`)?.phone;
  assert(importedPhone === '+91 9123456789', `Imported phone was not normalized; received ${importedPhone}.`);
  const fridayToDelete = other.friday_collections[0];
  const { error: deleteFridayError } = await client.rpc('delete_friday_collection', { p_collection_id: fridayToDelete.id });
  if (deleteFridayError) throw deleteFridayError;
  const { data: afterDelete, error: afterDeleteError } = await client.rpc('get_other_income', { p_month: period.month, p_year: period.year });
  if (afterDeleteError) throw afterDeleteError;
  assert(afterDelete.friday_collections.length === 4 && afterDelete.room_rents.length === 2, 'Deleting one Friday affected unrelated rows.');
  const { client: secondClient } = await createTestClient(env, `${suffix}b`, 'Other income isolation verification');
  const { data: isolated, error: isolatedError } = await secondClient.rpc('get_other_income', { p_month: period.month, p_year: period.year });
  if (isolatedError) throw isolatedError;
  assert(isolated.friday_collections.length === 0 && isolated.room_rents.length === 0, 'Other-income records leaked across accounts.');
  assert(membersBeforePhone.length + 3 === importedMembers.length, 'Unexpected member count change during isolated verification.');
  console.log(JSON.stringify({ verified: true, username, fridayRows: other.friday_collections.length, fridayTotal: other.friday_total, roomRentTotal: other.room_rent_total, otherTotal: other.other_total, otherCash: other.cash_total, otherAccount: other.account_total, normalizedPhone: phoneMember.phone, importedPhone, remainingFridaysAfterDelete: afterDelete.friday_collections.length, isolationVerified: true }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
