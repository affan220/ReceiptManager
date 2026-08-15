const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  const entries = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const value = line.slice(index + 1).trim();
    entries[line.slice(0, index)] = value.replace(/^['\"]|['\"]$/g, '');
  }
  return entries;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'client', '.env'));
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `ledgerqa${suffix}`;
  const email = `${username}@masjid.local`;
  const password = 'LedgerQa!2026secure';

  const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
  if (signUpError) throw signUpError;
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { error: claimError } = await supabase.rpc('claim_active_session', { p_take_over: false, p_device_label: 'Ledger verification' });
  if (claimError) throw claimError;

  const person = `Ledger QA ${suffix}`;
  const { data: allMonthsData, error: allMonthsError } = await supabase.rpc('create_member_dues', {
    p_name: person,
    p_phone: `+9100${suffix.slice(-8)}`,
    p_amount: 200,
    p_month: 1,
    p_year: 2028,
    p_all_months: true,
    p_initial_status: 'pending',
    p_payment_amount: 0,
    p_payment_date: null,
    p_payment_method: 'cash',
    p_voucher_number: null,
    p_hold: false,
    p_notes: 'Automated ledger verification',
  });
  if (allMonthsError) throw allMonthsError;
  assert(Number(allMonthsData.created_count) === 12, `Expected 12 independent monthly dues; received ${allMonthsData.created_count}.`);

  const { data: ledgerMembers, error: membersError } = await supabase.rpc('get_ledger_members');
  if (membersError) throw membersError;
  const qaDues = ledgerMembers.filter((due) => due.name === person && due.year === 2028).sort((a, b) => a.month - b.month);
  assert(qaDues.length === 12, `Expected 12 visible monthly dues; found ${qaDues.length}.`);

  const aprilDue = qaDues.find((due) => due.month === 4);
  const { data: autoPayment, error: autoPaymentError } = await supabase.rpc('record_member_payment', {
    p_due_member_id: aprilDue.id,
    p_amount: 600,
    p_payment_date: '2028-08-14',
    p_payment_method: 'cash',
    p_voucher_number: `QA-AUTO-${suffix}`,
    p_notes: 'Automatic oldest-pending allocation verification',
    p_allocations: null,
  });
  if (autoPaymentError) throw autoPaymentError;
  assert(autoPayment.allocations.length === 3, 'Expected three automatic allocations for a 600 payment.');

  const { data: afterAuto, error: afterAutoError } = await supabase.rpc('get_ledger_members');
  if (afterAutoError) throw afterAutoError;
  const autoDues = afterAuto.filter((due) => due.name === person && due.year === 2028).sort((a, b) => a.month - b.month);
  assert(autoDues[0].status === 'paid' && autoDues[1].status === 'paid' && autoDues[2].status === 'paid', 'Automatic allocation did not clear the oldest three months.');
  assert(autoDues[3].status !== 'paid', 'Automatic allocation incorrectly cleared April.');

  const manualAllocations = [4, 6, 7].map((month) => ({
    monthly_due_id: autoDues.find((due) => due.month === month).id,
    allocated_amount: 200,
  }));
  const { data: manualPayment, error: manualPaymentError } = await supabase.rpc('record_member_payment', {
    p_due_member_id: autoDues.find((due) => due.month === 4).id,
    p_amount: 600,
    p_payment_date: '2028-08-15',
    p_payment_method: 'account',
    p_voucher_number: `QA-MANUAL-${suffix}`,
    p_notes: 'Manual allocation verification',
    p_allocations: manualAllocations,
  });
  if (manualPaymentError) throw manualPaymentError;
  assert(manualPayment.allocations.length === 3, 'Expected three manual allocations.');

  const partialName = `Ledger Partial ${suffix}`;
  const { data: partialCreate, error: partialCreateError } = await supabase.rpc('create_member_dues', {
    p_name: partialName,
    p_phone: `+9199${suffix.slice(-8)}`,
    p_amount: 200,
    p_month: 9,
    p_year: 2028,
    p_all_months: false,
    p_initial_status: 'pending',
    p_payment_amount: 0,
    p_payment_date: null,
    p_payment_method: 'cash',
    p_voucher_number: null,
    p_hold: false,
    p_notes: 'Partial payment verification',
  });
  if (partialCreateError) throw partialCreateError;
  const partialDueId = partialCreate.created_due_ids[0];
  const { data: partialPayment, error: partialPaymentError } = await supabase.rpc('record_member_payment', {
    p_due_member_id: partialDueId,
    p_amount: 100,
    p_payment_date: '2028-08-16',
    p_payment_method: 'cash',
    p_voucher_number: `QA-PARTIAL-${suffix}`,
    p_notes: 'Partial payment verification',
    p_allocations: null,
  });
  if (partialPaymentError) throw partialPaymentError;

  const { data: partialDetail, error: partialDetailError } = await supabase.rpc('get_monthly_due_detail', { p_due_member_id: partialDueId });
  if (partialDetailError) throw partialDetailError;
  assert(partialDetail.due.status === 'partial', `Expected partial status; received ${partialDetail.due.status}.`);
  assert(Number(partialDetail.due.amount_pending) === 100, `Expected 100 pending; received ${partialDetail.due.amount_pending}.`);

  const { error: duplicateVoucherError } = await supabase.rpc('record_member_payment', {
    p_due_member_id: partialDueId,
    p_amount: 100,
    p_payment_date: '2028-08-17',
    p_payment_method: 'cash',
    p_voucher_number: `QA-PARTIAL-${suffix}`,
    p_notes: 'Duplicate voucher rejection verification',
    p_allocations: null,
  });
  assert(duplicateVoucherError, 'Expected duplicate voucher protection to reject a second payment.');

  const deleteName = `Ledger Delete ${suffix}`;
  const { data: deleteCreate, error: deleteCreateError } = await supabase.rpc('create_member_dues', {
    p_name: deleteName,
    p_phone: `+9188${suffix.slice(-8)}`,
    p_amount: 150,
    p_month: 1,
    p_year: 2029,
    p_all_months: true,
    p_initial_status: 'pending',
    p_payment_amount: 0,
    p_payment_date: null,
    p_payment_method: 'cash',
    p_voucher_number: null,
    p_hold: false,
    p_notes: 'Month-specific delete verification',
  });
  if (deleteCreateError) throw deleteCreateError;
  const { data: beforeDelete, error: beforeDeleteError } = await supabase.rpc('get_ledger_members');
  if (beforeDeleteError) throw beforeDeleteError;
  const marchDue = beforeDelete.find((due) => due.name === deleteName && due.year === 2029 && due.month === 3);
  const { error: deleteError } = await supabase.rpc('delete_monthly_due', { p_due_member_id: marchDue.id });
  if (deleteError) throw deleteError;
  const { data: afterDelete, error: afterDeleteError } = await supabase.rpc('get_ledger_members');
  if (afterDeleteError) throw afterDeleteError;
  const remainingDeleteDues = afterDelete.filter((due) => due.name === deleteName && due.year === 2029);
  assert(remainingDeleteDues.length === 11, `Expected only March to be deleted; found ${remainingDeleteDues.length} remaining months.`);
  assert(!remainingDeleteDues.some((due) => due.month === 3), 'Deleted March record still appears in the ledger.');

  const { data: summary, error: summaryError } = await supabase.rpc('get_ledger_dashboard_summary', { p_month: 8, p_year: 2028 });
  if (summaryError) throw summaryError;
  assert(Number(summary.monthly_collection) >= 1200, `Expected August actual collection to include 1200; received ${summary.monthly_collection}.`);

  const { data: receipt, error: receiptError } = await supabase.rpc('create_payment_receipt', { p_payment_id: autoPayment.payment_id });
  if (receiptError) throw receiptError;
  assert(receipt.voucher_number === `QA-AUTO-${suffix}`, 'Receipt did not retain the payment voucher.');
  assert(receipt.payment_date === '2028-08-14', 'Receipt did not retain the actual payment date.');

  console.log(JSON.stringify({
    verified: true,
    username,
    allMonthsCreated: allMonthsData.created_count,
    automaticAllocations: autoPayment.allocations.length,
    manualAllocations: manualPayment.allocations.length,
    partialDueOutstanding: partialDetail.due.amount_pending,
    remainingAfterMonthlyDelete: remainingDeleteDues.length,
    augustActualCollection: summary.monthly_collection,
    receiptNo: receipt.receipt_no,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
