const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv(filePath) {
  const values = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function same(actual, expected, message) { assert(Math.abs(Number(actual) - Number(expected)) < 0.001, `${message}; expected ${expected}, received ${actual}.`); }
async function rpc(client, name, params) { const { data, error } = await client.rpc(name, params); if (error) throw error; return data; }

async function createUnpaidDue(client, { name, phone, month, year, amount }) {
  const result = await rpc(client, "create_member_dues", {
    p_name: name,
    p_phone: phone,
    p_amount: amount,
    p_month: month,
    p_year: year,
    p_all_months: false,
    p_initial_status: "unpaid",
    p_payment_amount: 0,
    p_payment_date: null,
    p_payment_method: "cash",
    p_voucher_number: null,
    p_hold: false,
    p_notes: "Payment date verification",
  });
  const dueId = Array.isArray(result.created_due_ids) ? result.created_due_ids[0] : null;
  assert(dueId, "A test due was not created.");
  return dueId;
}

async function main() {
  const env = loadEnv(path.join(__dirname, "..", "client", ".env"));
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const username = `paymentdateqa${suffix}`;
  const password = "PaymentDateQa!2026secure";
  const year = 2028;
  const { error: signupError } = await client.auth.signUp({ email: `${username}@masjid.local`, password, options: { data: { username } } });
  if (signupError) throw signupError;
  const { error: signInError } = await client.auth.signInWithPassword({ email: `${username}@masjid.local`, password });
  if (signInError) throw signInError;
  await rpc(client, "claim_active_session", { p_take_over: false, p_device_label: "Payment date verification" });

  const janDue = await createUnpaidDue(client, { name: `January QA ${suffix}`, phone: `801${suffix.slice(-7)}`, month: 11, year, amount: 1100 });
  const marchDue = await createUnpaidDue(client, { name: `March QA ${suffix}`, phone: `802${suffix.slice(-7)}`, month: 8, year, amount: 2200 });
  const augustDue = await createUnpaidDue(client, { name: `August QA ${suffix}`, phone: `803${suffix.slice(-7)}`, month: 1, year, amount: 3300 });

  const january = await rpc(client, "record_member_payment", { p_due_member_id: janDue, p_amount: 1100, p_payment_date: `${year}-01-10`, p_payment_method: "cash", p_voucher_number: `JAN-${suffix}`, p_notes: "January payment date test", p_allocations: null });
  const march = await rpc(client, "record_member_payment", { p_due_member_id: marchDue, p_amount: 2200, p_payment_date: `${year}-03-25`, p_payment_method: "account", p_voucher_number: `MAR-${suffix}`, p_notes: "March payment date test", p_allocations: null });
  const august = await rpc(client, "record_member_payment", { p_due_member_id: augustDue, p_amount: 3300, p_payment_date: `${year}-08-05`, p_payment_method: "cash", p_voucher_number: `AUG-${suffix}`, p_notes: "August payment date test", p_allocations: null });

  assert(january.payment_date === `${year}-01-10`, "January payment date was not retained.");
  assert(march.payment_date === `${year}-03-25`, "March payment date was not retained.");
  assert(august.payment_date === `${year}-08-05`, "August payment date was not retained.");

  const januarySummary = await rpc(client, "get_ledger_dashboard_summary", { p_month: 1, p_year: year });
  const marchSummary = await rpc(client, "get_ledger_dashboard_summary", { p_month: 3, p_year: year });
  const augustSummary = await rpc(client, "get_ledger_dashboard_summary", { p_month: 8, p_year: year });
  const novemberSummary = await rpc(client, "get_ledger_dashboard_summary", { p_month: 11, p_year: year });
  same(januarySummary.monthly_collection, 1100, "January summary must use the January payment date");
  same(marchSummary.monthly_collection, 2200, "March summary must use the March payment date, not the August due month");
  same(augustSummary.monthly_collection, 3300, "August summary must use the August payment date, not the January due month");
  same(novemberSummary.monthly_collection, 0, "A November due must not move the January payment into November totals");
  same(marchSummary.cash_received, 0, "March cash total is incorrect");
  same(marchSummary.account_received, 2200, "March account total is incorrect");

  const payments = await rpc(client, "get_ledger_payments", {});
  const created = [january, march, august];
  for (const payment of created) {
    const row = payments.find((entry) => entry.id === payment.payment_id);
    assert(row && row.payment_date === payment.payment_date, `Payment history did not retain ${payment.payment_date}.`);
  }

  const receipt = await rpc(client, "create_payment_receipt", { p_payment_id: march.payment_id });
  assert(receipt.payment_date === `${year}-03-25`, "Receipt date did not retain the March payment date.");

  console.log(JSON.stringify({
    verified: true,
    username,
    dates: { january: january.payment_date, march: march.payment_date, august: august.payment_date },
    monthlyCollections: { january: januarySummary.monthly_collection, march: marchSummary.monthly_collection, august: augustSummary.monthly_collection, november: novemberSummary.monthly_collection },
    receiptPaymentDate: receipt.payment_date,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
