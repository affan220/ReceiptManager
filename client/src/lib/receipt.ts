import jsPDF from "jspdf";
import QRCode from "qrcode";
import { Member, OrgSettings, MONTHS } from "./store";
import { PaymentRecord, createPaymentReceipt, getCurrentUser } from "./DatabaseService";

function formatPdfAmount(amount: number) {
  return `RS ${amount.toLocaleString()}`;
}

function coveredPeriods(payment: PaymentRecord) {
  if (!payment.allocations.length) return "Contribution payment";
  return payment.allocations
    .map((allocation) => `${MONTHS[allocation.month - 1]} ${allocation.year}`)
    .join(", ");
}

export async function generateReceiptPDF(member: Member, payment: PaymentRecord, settings: OrgSettings) {
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("User is not authenticated.");

  const receipt = await createPaymentReceipt(payment.id, currentUser.id);
  const doc = new jsPDF({ unit: "pt", format: "a5", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setDrawColor(20, 120, 90);
  doc.setLineWidth(1.5);
  doc.rect(18, 18, pageW - 36, pageH - 36, "S");
  doc.setLineWidth(0.5);
  doc.rect(24, 24, pageW - 48, pageH - 48, "S");

  doc.setFillColor(20, 120, 90);
  doc.rect(24, 24, pageW - 48, 56, "F");
  if (settings.logoDataUrl) {
    try { doc.addImage(settings.logoDataUrl, "PNG", 34, 32, 40, 40); } catch { /* Preserve receipt generation even when a logo is invalid. */ }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(settings.name, settings.logoDataUrl ? 82 : 34, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(settings.tagline, settings.logoDataUrl ? 82 : 34, 66);
  doc.setFontSize(9);
  doc.text(settings.address, pageW - 34, 50, { align: "right" });
  doc.text(`${settings.phone}  ·  ${settings.email}`, pageW - 34, 64, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("DONATION RECEIPT", pageW / 2, 102, { align: "center" });
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.line(40, 112, pageW - 40, 112);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Receipt No:", 40, 132);
  doc.text("Payment Date:", 40, 148);
  doc.text("Payment Mode:", 40, 164);
  doc.setFont("helvetica", "normal");
  doc.text(receipt.receiptNo, 125, 132);
  doc.text(new Date(`${payment.paymentDate}T00:00:00`).toLocaleDateString(), 125, 148);
  doc.text(payment.paymentMethod === "account" ? "Account" : "Cash", 125, 164);

  doc.setFont("helvetica", "bold");
  doc.text("Payment covers:", pageW / 2, 132);
  doc.setFont("helvetica", "normal");
  const periods = coveredPeriods(payment);
  const shortenedPeriods = periods.length > 42 ? `${periods.slice(0, 39)}...` : periods;
  doc.text(shortenedPeriods, pageW / 2 + 80, 132);
  doc.setFont("helvetica", "bold");
  doc.text("Voucher:", pageW / 2, 148);
  doc.setFont("helvetica", "normal");
  doc.text(payment.voucherNumber || receipt.voucherNumber, pageW / 2 + 80, 148);
  doc.setFont("helvetica", "bold");
  doc.text("Due reference:", pageW / 2, 164);
  doc.setFont("helvetica", "normal");
  doc.text(`${MONTHS[member.month - 1]} ${member.year}`, pageW / 2 + 80, 164);

  doc.setDrawColor(220);
  doc.roundedRect(40, 178, pageW - 80, 68, 6, 6, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Received from:", 50, 196);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(member.name, 50, 214);
  doc.setFontSize(10);
  doc.text(member.phone || "—", 50, 230);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Amount Received", pageW - 180, 196);
  doc.setFontSize(20);
  doc.setTextColor(20, 120, 90);
  doc.text(formatPdfAmount(payment.amount), pageW - 50, 226, { align: "right" });
  doc.setTextColor(30, 30, 30);

  try {
    const qrData = JSON.stringify({ r: receipt.receiptNo, v: payment.voucherNumber, n: member.name, a: payment.amount, d: payment.paymentDate });
    const qrUrl = await QRCode.toDataURL(qrData, { width: 200, margin: 0 });
    doc.addImage(qrUrl, "PNG", 50, 256, 70, 70);
  } catch { /* Keep the receipt usable if QR generation fails. */ }

  doc.setDrawColor(120);
  doc.setLineWidth(0.5);
  doc.line(pageW - 200, 310, pageW - 50, 310);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(settings.signatureLabel, pageW - 125, 324, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Thank you for your generous contribution. May Allah accept it.", pageW / 2, pageH - 40, { align: "center" });

  doc.save(`Receipt-${receipt.receiptNo}-${member.name.replace(/\s+/g, "_")}.pdf`);
  return receipt.receiptNo;
}
