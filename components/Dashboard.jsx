// components/Dashboard.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import {
  CalendarDays,
  Car,
  Banknote,
  ClipboardList,
  LogOut,
  FileText,
  LayoutDashboard,
  Settings,
  ReceiptText,
  Building2,
  ScrollText,
  UsersRound,
  Plus,
  Trash2,
} from "lucide-react";

import { auth, db } from "../lib/firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  increment,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";

const GHANA_VAT_RATE = 0.15;
const GHANA_NHIL_RATE = 0.025;
const GHANA_GETFUND_RATE = 0.025;

const DEFAULT_COMPANY_PROFILE = {
  companyName: "MAALVILA Car Rental Services",
  companyEmail: "maalvilaent@gmail.com",
  companyPhone: "0209374110 / 0592242429 / 0242164552",
  companyAddress: "",
  companyTin: "",
  vatNumber: "",
  logoUrl: "",
  letterheadUrl: "",
  vatEnabled: true,
  vatMode: "exclusive",
  quotationTerms:
    "This quotation is subject to vehicle availability, confirmation of booking, and agreed payment terms.",
  invoiceFooter: "Thank you for doing business with us.",
  receiptFooter: "Payment received with thanks.",
};

function isFirestoreTimestamp(x) {
  return x && typeof x === "object" && typeof x.seconds === "number" && typeof x.nanoseconds === "number";
}
function toDateSafe(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (isFirestoreTimestamp(x)) return new Date(x.seconds * 1000);
  if (x && typeof x.toDate === "function") return x.toDate();
  if (typeof x === "string") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function toISODateString(d) {
  if (!(d instanceof Date)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function normalizeSelectedDates(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return arr
    .map(toDateSafe)
    .filter(Boolean)
    .map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    .filter((d) => {
      const k = toISODateString(d);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a - b);
}
function sameDay(a, b) {
  return a instanceof Date && b instanceof Date && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function currencyGH(amount) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(n);
  } catch {
    return `GH₵ ${n.toFixed(2)}`;
  }
}
function hashColor(str) {
  let h = 0;
  const s = String(str || "item");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}
function getQuarterLabel(d) {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}
function getMonthLabel(d) {
  return format(d, "MMM yyyy");
}
function safeTimeToLocaleString(x) {
  const d = toDateSafe(x);
  return d ? d.toLocaleString() : "";
}
function clampMoney(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}
function clampPct(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
function normalizeCarNumber(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}
function sourceTypeLabel(type) {
  if (type === "main") return "Main / MAALVILA";
  if (type === "rental_company") return "Attached Rental Company";
  if (type === "individual") return "Individual / Other";
  return "Unknown";
}
function sourceBadgeClass(type) {
  if (type === "main") return "text-emerald-800 bg-emerald-50 border-emerald-200";
  if (type === "rental_company") return "text-blue-800 bg-blue-50 border-blue-200";
  if (type === "individual") return "text-violet-800 bg-violet-50 border-violet-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}
function generateDocNumber(prefix) {
  const d = new Date();
  return `${prefix}-${format(d, "yyyyMMdd")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}
function normalizeClientVatMode(value) {
  const mode = String(value || "").trim();
  if (["exclusive", "inclusive", "none", "exempt"].includes(mode)) return mode;
  return "exclusive";
}
function getDefaultClientVatMode(companyProfile = DEFAULT_COMPANY_PROFILE) {
  if (!companyProfile?.vatEnabled) return "none";
  return normalizeClientVatMode(companyProfile?.vatMode || "exclusive");
}
function clientVatModeLabel(mode) {
  const normalized = normalizeClientVatMode(mode);
  if (normalized === "inclusive") return "VAT Inclusive - tax extracted from agreed rate";
  if (normalized === "none") return "No VAT / VAT not required";
  if (normalized === "exempt") return "VAT Exempt client";
  return "VAT Exclusive - tax added on top";
}
function clientVatApplies(mode) {
  const normalized = normalizeClientVatMode(mode);
  return normalized === "exclusive" || normalized === "inclusive";
}

function computeGhanaVatSummary(baseAmount, discountAmount = 0, vatEnabled = true, vatMode = "exclusive") {
  const subtotal = clampMoney(baseAmount);
  const discount = Math.min(clampMoney(discountAmount), subtotal);
  const amountAfterDiscount = Math.max(0, subtotal - discount);
  const normalizedVatMode = normalizeClientVatMode(vatMode);
  if (!vatEnabled || normalizedVatMode === "none" || normalizedVatMode === "exempt") {
    return {
      subtotal,
      discount,
      taxableAmount: amountAfterDiscount,
      vat: 0,
      nhil: 0,
      getfund: 0,
      totalTax: 0,
      grandTotal: amountAfterDiscount,
      vatMode: normalizedVatMode === "exempt" ? "exempt" : "none",
      taxIncludedInRate: false,
    };
  }

  if (normalizedVatMode === "inclusive") {
    const taxableAmount = amountAfterDiscount / (1 + GHANA_VAT_RATE + GHANA_NHIL_RATE + GHANA_GETFUND_RATE);
    const vat = taxableAmount * GHANA_VAT_RATE;
    const nhil = taxableAmount * GHANA_NHIL_RATE;
    const getfund = taxableAmount * GHANA_GETFUND_RATE;
    return {
      subtotal,
      discount,
      taxableAmount,
      vat,
      nhil,
      getfund,
      totalTax: vat + nhil + getfund,
      grandTotal: amountAfterDiscount,
      vatMode: "inclusive",
      taxIncludedInRate: true,
    };
  }

  const taxableAmount = amountAfterDiscount;
  const vat = taxableAmount * GHANA_VAT_RATE;
  const nhil = taxableAmount * GHANA_NHIL_RATE;
  const getfund = taxableAmount * GHANA_GETFUND_RATE;
  return {
    subtotal,
    discount,
    taxableAmount,
    vat,
    nhil,
    getfund,
    totalTax: vat + nhil + getfund,
    grandTotal: taxableAmount + vat + nhil + getfund,
    vatMode: "exclusive",
    taxIncludedInRate: false,
  };
}
function vatModeLabel(vatEnabled, vatMode) {
  if (!vatEnabled) return "No VAT / VAT not required";
  return clientVatModeLabel(vatMode || "exclusive");
}
function computeDiscountAmount(baseAmount, discountType, discountValue) {
  const base = clampMoney(baseAmount);
  const value = Number(discountValue || 0);
  if (!Number.isFinite(value) || value <= 0 || discountType === "none") return 0;
  if (discountType === "percentage") return Math.min(base, base * (Math.min(value, 100) / 100));
  if (discountType === "fixed") return Math.min(base, value);
  return 0;
}
function discountLabel(type) {
  if (type === "fixed") return "Fixed Amount (GHS)";
  if (type === "percentage") return "Percentage of Client Gross (%)";
  return "No Discount";
}
function makeItemId() {
  return `item-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}
function blankBookingItem() {
  return {
    itemId: makeItemId(),
    carNumber: "",
    travelFrom: "",
    travelTo: "",
    driver: "",
    driverPhone: "",
    selectedDates: [],
    supplierRate: "",
    adminCharge: "",
    discountType: "none",
    discountValue: "",
    clientVatMode: "",
    supplierDiscountSharePct: 50,
    adminDiscountSharePct: 50,
  };
}
function computeItemSplit(rawItem, fallbackSelectedDates = [], cars = []) {
  const itemDates = normalizeSelectedDates(
    Array.isArray(rawItem?.selectedDates) && rawItem.selectedDates.length
      ? rawItem.selectedDates
      : fallbackSelectedDates
  );
  const days = itemDates.length;
  const carObj = cars.find((c) => String(c.number) === String(rawItem.carNumber));
  const supplierRate = clampMoney(rawItem.supplierRate);
  const adminCharge = clampMoney(rawItem.adminCharge);
  const clientDailyRate = supplierRate + adminCharge;
  const grossSupplierAmount = supplierRate * days;
  const grossAdminAmount = adminCharge * days;
  const grossClientAmount = clientDailyRate * days;
  const discountType = rawItem.discountType || "none";
  const discountValue = Number(rawItem.discountValue || 0);
  const discountAmount = computeDiscountAmount(grossClientAmount, discountType, discountValue);
  const clientVatMode = normalizeClientVatMode(rawItem.clientVatMode || rawItem.vatMode || "exclusive");
  const vatSummary = computeGhanaVatSummary(grossClientAmount, discountAmount, clientVatApplies(clientVatMode), clientVatMode);
  let supplierPct = clampPct(rawItem.supplierDiscountSharePct);
  let adminPct = clampPct(rawItem.adminDiscountSharePct);
  const pctTotal = supplierPct + adminPct;
  if (pctTotal <= 0) {
    supplierPct = 0;
    adminPct = 100;
  } else if (Math.abs(pctTotal - 100) > 0.0001) {
    supplierPct = (supplierPct / pctTotal) * 100;
    adminPct = 100 - supplierPct;
  }
  const supplierDiscountShare = discountAmount * (supplierPct / 100);
  const adminDiscountShare = discountAmount * (adminPct / 100);
  const netSupplierPayable = Math.max(0, grossSupplierAmount - supplierDiscountShare);
  const netAdminIncome = Math.max(0, grossAdminAmount - adminDiscountShare);
  const netClientAmount = Math.max(0, grossClientAmount - discountAmount);
  return {
    itemId: rawItem.itemId || makeItemId(),
    carNumber: String(rawItem.carNumber || ""),
    carName: rawItem.carName || carObj?.name || "",
    sourceId: rawItem.sourceId || carObj?.sourceId || "",
    sourceName: rawItem.sourceName || carObj?.sourceName || "",
    sourceType: rawItem.sourceType || carObj?.sourceType || "main",
    travelFrom: rawItem.travelFrom || "",
    travelTo: rawItem.travelTo || "",
    driver: rawItem.driver || "",
    driverPhone: rawItem.driverPhone || "",
    dispatchStartKm: rawItem.dispatchStartKm ?? "",
    dispatchEndKm: rawItem.dispatchEndKm ?? "",
    dispatchKmCovered: rawItem.dispatchKmCovered ?? "",
    dispatchFuelCost: rawItem.dispatchFuelCost ?? "",
    dispatchFuelBillingMode: rawItem.dispatchFuelBillingMode || "client_paid_direct",
    dispatchFuelReceiptRef: rawItem.dispatchFuelReceiptRef || "",
    dispatchFuelReimbursedAmount: rawItem.dispatchFuelReimbursedAmount ?? "",
    dispatchFuelReimbursementDate: rawItem.dispatchFuelReimbursementDate || "",
    dispatchFuelReimbursementRef: rawItem.dispatchFuelReimbursementRef || "",
    dispatchCloseoutNotes: rawItem.dispatchCloseoutNotes || "",
    dispatchClosed: Boolean(rawItem.dispatchClosed),
    dispatchCloseoutAt: rawItem.dispatchCloseoutAt || null,
    dispatchCloseoutByEmail: rawItem.dispatchCloseoutByEmail || "",
    selectedDates: itemDates,
    dateText: itemDates.map(toISODateString).join(", "),
    supplierRate,
    adminCharge,
    clientDailyRate,
    discountType,
    discountValue: Number.isFinite(discountValue) ? discountValue : 0,
    clientVatMode,
    vatSummary,
    vatLabel: clientVatModeLabel(clientVatMode),
    vatAmount: vatSummary.vat,
    nhilAmount: vatSummary.nhil,
    getfundAmount: vatSummary.getfund,
    taxAmount: vatSummary.totalTax,
    clientGrandTotal: vatSummary.grandTotal,
    supplierDiscountSharePct: Number(supplierPct.toFixed(4)),
    adminDiscountSharePct: Number(adminPct.toFixed(4)),
    days,
    grossSupplierAmount,
    grossAdminAmount,
    grossClientAmount,
    discountAmount,
    supplierDiscountShare,
    adminDiscountShare,
    netSupplierPayable,
    netAdminIncome,
    netClientAmount,
  };
}

function computeItemVatSplitTransparency(item) {
  const supplierBase = clampMoney(item?.netSupplierPayable ?? item?.grossSupplierAmount);
  const adminBase = clampMoney(item?.netAdminIncome ?? item?.grossAdminAmount);
  const totalBase = supplierBase + adminBase;
  const supplierRatio = totalBase > 0 ? supplierBase / totalBase : 0;
  const vat = clampMoney(item?.vatSummary?.vat ?? item?.vatAmount);
  const nhil = clampMoney(item?.vatSummary?.nhil ?? item?.nhilAmount);
  const getfund = clampMoney(item?.vatSummary?.getfund ?? item?.getfundAmount);
  const totalTax = clampMoney(item?.vatSummary?.totalTax ?? item?.taxAmount);
  const supplierVat = vat * supplierRatio;
  const supplierNhil = nhil * supplierRatio;
  const supplierGetfund = getfund * supplierRatio;
  const supplierTotalTax = totalTax * supplierRatio;
  return {
    supplierBase,
    adminBase,
    supplierVat,
    supplierNhil,
    supplierGetfund,
    supplierTotalTax,
    adminVat: Math.max(0, vat - supplierVat),
    adminNhil: Math.max(0, nhil - supplierNhil),
    adminGetfund: Math.max(0, getfund - supplierGetfund),
    adminTotalTax: Math.max(0, totalTax - supplierTotalTax),
    totalVat: vat,
    totalNhil: nhil,
    totalGetfund: getfund,
    totalTax,
  };
}

function computeVatSplitTransparencyTotals(items = []) {
  return (items || []).reduce((totals, item) => {
    const split = computeItemVatSplitTransparency(item);
    totals.supplierBase += split.supplierBase;
    totals.adminBase += split.adminBase;
    totals.supplierVat += split.supplierVat;
    totals.supplierNhil += split.supplierNhil;
    totals.supplierGetfund += split.supplierGetfund;
    totals.supplierTotalTax += split.supplierTotalTax;
    totals.adminVat += split.adminVat;
    totals.adminNhil += split.adminNhil;
    totals.adminGetfund += split.adminGetfund;
    totals.adminTotalTax += split.adminTotalTax;
    totals.totalVat += split.totalVat;
    totals.totalNhil += split.totalNhil;
    totals.totalGetfund += split.totalGetfund;
    totals.totalTax += split.totalTax;
    return totals;
  }, {
    supplierBase: 0,
    adminBase: 0,
    supplierVat: 0,
    supplierNhil: 0,
    supplierGetfund: 0,
    supplierTotalTax: 0,
    adminVat: 0,
    adminNhil: 0,
    adminGetfund: 0,
    adminTotalTax: 0,
    totalVat: 0,
    totalNhil: 0,
    totalGetfund: 0,
    totalTax: 0,
  });
}

function emptyPricingTotals() {
  return {
    totalGrossClientAmount: 0,
    totalDiscountAmount: 0,
    totalNetClientAmount: 0,
    totalGrossSupplierAmount: 0,
    totalSupplierDiscountShare: 0,
    totalNetSupplierPayable: 0,
    totalGrossAdminAmount: 0,
    totalAdminDiscountShare: 0,
    totalNetAdminIncome: 0,
    totalTaxableAmount: 0,
    totalVat: 0,
    totalNhil: 0,
    totalGetfund: 0,
    totalTaxAmount: 0,
    totalClientGrandAmount: 0,
  };
}
function computePricingTotals(items) {
  return (items || []).reduce((t, item) => ({
    totalGrossClientAmount: t.totalGrossClientAmount + clampMoney(item.grossClientAmount),
    totalDiscountAmount: t.totalDiscountAmount + clampMoney(item.discountAmount),
    totalNetClientAmount: t.totalNetClientAmount + clampMoney(item.netClientAmount),
    totalGrossSupplierAmount: t.totalGrossSupplierAmount + clampMoney(item.grossSupplierAmount),
    totalSupplierDiscountShare: t.totalSupplierDiscountShare + clampMoney(item.supplierDiscountShare),
    totalNetSupplierPayable: t.totalNetSupplierPayable + clampMoney(item.netSupplierPayable),
    totalGrossAdminAmount: t.totalGrossAdminAmount + clampMoney(item.grossAdminAmount),
    totalAdminDiscountShare: t.totalAdminDiscountShare + clampMoney(item.adminDiscountShare),
    totalNetAdminIncome: t.totalNetAdminIncome + clampMoney(item.netAdminIncome),
    totalTaxableAmount: t.totalTaxableAmount + clampMoney(item?.vatSummary?.taxableAmount),
    totalVat: t.totalVat + clampMoney(item?.vatSummary?.vat),
    totalNhil: t.totalNhil + clampMoney(item?.vatSummary?.nhil),
    totalGetfund: t.totalGetfund + clampMoney(item?.vatSummary?.getfund),
    totalTaxAmount: t.totalTaxAmount + clampMoney(item?.vatSummary?.totalTax),
    totalClientGrandAmount: t.totalClientGrandAmount + clampMoney(item?.vatSummary?.grandTotal),
  }), emptyPricingTotals());
}
function computeBookingVatSummaryFromItems(items = []) {
  return (items || []).reduce((summary, item) => {
    const lineVat = item?.vatSummary || computeGhanaVatSummary(
      item?.grossClientAmount || 0,
      item?.discountAmount || 0,
      clientVatApplies(item?.clientVatMode),
      item?.clientVatMode || "exclusive"
    );
    summary.subtotal += clampMoney(lineVat.subtotal);
    summary.discount += clampMoney(lineVat.discount);
    summary.taxableAmount += clampMoney(lineVat.taxableAmount);
    summary.vat += clampMoney(lineVat.vat);
    summary.nhil += clampMoney(lineVat.nhil);
    summary.getfund += clampMoney(lineVat.getfund);
    summary.totalTax += clampMoney(lineVat.totalTax);
    summary.grandTotal += clampMoney(lineVat.grandTotal);
    summary.vatModes.add(clientVatModeLabel(item?.clientVatMode || "exclusive"));
    return summary;
  }, {
    subtotal: 0,
    discount: 0,
    taxableAmount: 0,
    vat: 0,
    nhil: 0,
    getfund: 0,
    totalTax: 0,
    grandTotal: 0,
    vatMode: "mixed",
    taxIncludedInRate: false,
    vatModes: new Set(),
  });
}
function getBookingVatSummary(booking, cars = []) {
  const summary = computeBookingVatSummaryFromItems(getBookingItems(booking, cars));
  return { ...summary, vatModesText: Array.from(summary.vatModes || []).join(" | ") || "—" };
}

function computeBookingDateSummary(items, fallbackSelectedDates = []) {
  const all = [];
  for (const item of items || []) {
    all.push(...normalizeSelectedDates(item?.selectedDates));
  }
  if (!all.length) all.push(...normalizeSelectedDates(fallbackSelectedDates));
  return normalizeSelectedDates(all);
}
function getBookingItems(b, cars = []) {
  const dates = normalizeSelectedDates(b?.selectedDates);
  if (Array.isArray(b?.bookingItems) && b.bookingItems.length) {
    return b.bookingItems.map((item) => computeItemSplit(item, dates, cars));
  }
  const legacyItem = {
    itemId: `legacy-${b?.id || "booking"}`,
    carNumber: b?.carNumber || "",
    carName: b?.carName || "",
    sourceId: b?.sourceId || "",
    sourceName: b?.sourceName || "",
    sourceType: b?.sourceType || "main",
    travelFrom: b?.travelFrom || "",
    travelTo: b?.travelTo || "",
    driver: b?.driver || "",
    driverPhone: b?.driverPhone || "",
    supplierRate: b?.supplierRate ?? 0,
    adminCharge: b?.adminCharge ?? b?.clientDailyRate ?? b?.dailyRate ?? 0,
    discountType: b?.discountType || "none",
    discountValue: b?.discountValue || 0,
    supplierDiscountSharePct: b?.supplierDiscountSharePct ?? 0,
    adminDiscountSharePct: b?.adminDiscountSharePct ?? 100,
  };
  return [computeItemSplit(legacyItem, dates, cars)];
}
function getBookingTotals(b, cars = []) {
  if (b?.pricingTotals && typeof b.pricingTotals === "object") return { ...emptyPricingTotals(), ...b.pricingTotals };
  return computePricingTotals(getBookingItems(b, cars));
}
function computeBookingTotalAmount(b, cars = []) {
  const totals = getBookingTotals(b, cars);
  if (b?.status === "cancelled") return Number(b?.penalty || 0) > 0 ? Number(b.penalty) : 0;
  if (b?.status === "confirmed" && Number(b?.confirmedAmount || 0) > 0) return Number(b.confirmedAmount);
  return totals.totalNetClientAmount;
}
function computePaymentStatus(total, paid) {
  const t = clampMoney(total), p = clampMoney(paid);
  if (t <= 0 || p <= 0) return "unpaid";
  return p + 0.0001 < t ? "partial" : "paid";
}
function can(role, action) {
  const r = role || "viewer";
  const map = {
    addCar: ["admin"],
    addSource: ["admin"],
    addBooking: ["admin", "staff"],
    editBooking: ["admin", "staff"],
    confirmBooking: ["admin"],
    cancelBooking: ["admin"],
    recordPayment: ["admin", "staff"],
    recordSupplierPayment: ["admin", "staff"],
    export: ["admin", "staff", "viewer"],
    settings: ["admin"],
    maintenance: ["admin"],
  };
  return (map[action] || []).includes(r);
}
function daysUntil(value) {
  const date = toDateSafe(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
function complianceStatus(value, warningDays = 30) {
  const d = daysUntil(value);
  if (d === null) return { label: "Not captured", className: "bg-slate-50 text-slate-700 border-slate-200", days: null };
  if (d < 0) return { label: "Expired", className: "bg-red-50 text-red-700 border-red-200", days: d };
  if (d <= warningDays) return { label: "Due soon", className: "bg-amber-50 text-amber-800 border-amber-200", days: d };
  return { label: "Valid", className: "bg-emerald-50 text-emerald-700 border-emerald-200", days: d };
}
function kmNumber(value) {
  const n = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function formatKm(value) {
  const n = kmNumber(value);
  return n ? `${n.toLocaleString()} km` : "—";
}
function kmServiceStatus({ currentOdometerKm, lastServiceKm, nextServiceKm, serviceIntervalKm }) {
  const current = kmNumber(currentOdometerKm);
  const last = kmNumber(lastServiceKm);
  const interval = kmNumber(serviceIntervalKm) || 5000;
  const next = kmNumber(nextServiceKm) || (last ? last + interval : 0);
  if (!current && !last && !next) return { label: "KM not captured", className: "bg-slate-50 text-slate-700 border-slate-200", remainingKm: null, kmSinceService: null, nextServiceKm: next };
  const kmSinceService = current && last ? Math.max(0, current - last) : null;
  if (!current || !next) return { label: "Monitor", className: "bg-amber-50 text-amber-800 border-amber-200", remainingKm: null, kmSinceService, nextServiceKm: next };
  const remainingKm = next - current;
  if (remainingKm <= 0) return { label: "Service due by KM", className: "bg-red-50 text-red-700 border-red-200", remainingKm, kmSinceService, nextServiceKm: next };
  if (remainingKm <= 1000) return { label: "KM due soon", className: "bg-amber-50 text-amber-800 border-amber-200", remainingKm, kmSinceService, nextServiceKm: next };
  return { label: "KM OK", className: "bg-emerald-50 text-emerald-700 border-emerald-200", remainingKm, kmSinceService, nextServiceKm: next };
}
function maintenanceOverallStatus(row) {
  const kmStatus = row.kmServiceStatus;
  const complianceStatuses = [row.insuranceStatus, row.roadworthyStatus];
  if (kmStatus?.label === "Service due by KM" || complianceStatuses.some((s) => s.label === "Expired")) return { label: "Attention required", className: "bg-red-50 text-red-700 border-red-200" };
  if (["KM due soon", "KM not captured", "Monitor"].includes(kmStatus?.label) || row.dateServiceStatus?.label === "Due soon" || complianceStatuses.some((s) => s.label === "Due soon" || s.label === "Not captured")) return { label: "Monitor", className: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "Good", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("viewer");
  const [roleEmail, setRoleEmail] = useState("");
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeView, setActiveView] = useState("overview");

  const [bookings, setBookings] = useState([]);
  const [cars, setCars] = useState([]);
  const [sources, setSources] = useState([]);
  const [audit, setAudit] = useState([]);

  const [customer, setCustomer] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [travelFrom, setTravelFrom] = useState("");
  const [travelTo, setTravelTo] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("email");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [selectedDates, setSelectedDates] = useState([]);
  const [bookingItems, setBookingItems] = useState([blankBookingItem()]);
  const [editBookingId, setEditBookingId] = useState(null);

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState("main");
  const [newSourceContactPerson, setNewSourceContactPerson] = useState("");
  const [newSourcePhone, setNewSourcePhone] = useState("");
  const [newSourceEmail, setNewSourceEmail] = useState("");
  const [newSourceAddress, setNewSourceAddress] = useState("");
  const [newCarName, setNewCarName] = useState("");
  const [newCarNumber, setNewCarNumber] = useState("");
  const [newCarSourceId, setNewCarSourceId] = useState("");

  const [filterCar, setFilterCar] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [maintenanceSearch, setMaintenanceSearch] = useState("");
  const [maintenanceDrafts, setMaintenanceDrafts] = useState({});
  const [tripCloseoutSearch, setTripCloseoutSearch] = useState("");
  const [tripCloseoutDrafts, setTripCloseoutDrafts] = useState({});
  const [trendMode, setTrendMode] = useState("monthly");
  const [customerLedgerSearch, setCustomerLedgerSearch] = useState("");
  const [supplierLedgerSearch, setSupplierLedgerSearch] = useState("");
  const [profitabilitySearch, setProfitabilitySearch] = useState("");
  const [fuelClaimsSearch, setFuelClaimsSearch] = useState("");

  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);

  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationBooking, setQuotationBooking] = useState(null);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [quotationNotes, setQuotationNotes] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceBooking, setInvoiceBooking] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [supplierStatementOpen, setSupplierStatementOpen] = useState(false);
  const [supplierStatementBooking, setSupplierStatementBooking] = useState(null);
  const [supplierStatementSourceId, setSupplierStatementSourceId] = useState("");
  const [supplierStatementNumber, setSupplierStatementNumber] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptBooking, setReceiptBooking] = useState(null);
  const [receiptNumber, setReceiptNumber] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [supplierRequestOpen, setSupplierRequestOpen] = useState(false);
  const [supplierRequestBooking, setSupplierRequestBooking] = useState(null);
  const [supplierRequestSourceId, setSupplierRequestSourceId] = useState("");
  const [supplierRequestNumber, setSupplierRequestNumber] = useState("");
  const [supplierRequestNotes, setSupplierRequestNotes] = useState("");
  const [supplierResponseOpen, setSupplierResponseOpen] = useState(false);
  const [supplierResponseBooking, setSupplierResponseBooking] = useState(null);
  const [supplierResponseSourceId, setSupplierResponseSourceId] = useState("");
  const [supplierResponseNumber, setSupplierResponseNumber] = useState("");
  const [supplierResponseNotes, setSupplierResponseNotes] = useState("");
  const [supplierResponseLines, setSupplierResponseLines] = useState([]);

  const [supplierVoucherOpen, setSupplierVoucherOpen] = useState(false);
  const [supplierVoucherBooking, setSupplierVoucherBooking] = useState(null);
  const [supplierVoucherSourceId, setSupplierVoucherSourceId] = useState("");
  const [supplierVoucherNumber, setSupplierVoucherNumber] = useState("");
  const [supplierVoucherNotes, setSupplierVoucherNotes] = useState("");

  const [supplierPaymentOpen, setSupplierPaymentOpen] = useState(false);
  const [supplierPaymentBooking, setSupplierPaymentBooking] = useState(null);
  const [supplierPaymentSourceId, setSupplierPaymentSourceId] = useState("");
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState("");
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState("cash");
  const [supplierPaymentReference, setSupplierPaymentReference] = useState("");
  const [supplierPaymentNote, setSupplierPaymentNote] = useState("");
  const [supplierPaymentHistory, setSupplierPaymentHistory] = useState([]);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentHistory, setPaymentHistory] = useState([]);

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);
  useEffect(() => {
    let cancelled = false;
    async function fetchRole() {
      if (!user?.uid) {
        setRole("viewer");
        setRoleEmail("");
        setLoadingRole(false);
        return;
      }
      setLoadingRole(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!cancelled) {
          if (snap.exists()) {
            const data = snap.data() || {};
            setRole((data.role || "viewer").toLowerCase());
            setRoleEmail(data.email || user.email || "");
          } else {
            setRole("viewer");
            setRoleEmail(user.email || "");
          }
        }
      } catch (e) {
        console.error("Role fetch error:", e);
        if (!cancelled) {
          setRole("viewer");
          setRoleEmail(user?.email || "");
        }
      } finally {
        if (!cancelled) setLoadingRole(false);
      }
    }
    fetchRole();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsubBookings = onSnapshot(collection(db, "bookings"), (snap) => setBookings(snap.docs.map((d) => {
      const data = d.data() || {};
      return { id: d.id, ...data, selectedDates: normalizeSelectedDates(data.selectedDates), amountPaid: Number(data.amountPaid || 0), paymentStatus: data.paymentStatus || "unpaid" };
    })), (e) => console.error("Bookings listener error:", e));
    const unsubCars = onSnapshot(collection(db, "cars"), (snap) => setCars(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.number || "").localeCompare(String(b.number || "")))), (e) => console.error("Cars listener error:", e));
    const unsubSources = onSnapshot(collection(db, "sources"), (snap) => setSources(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.sourceName || "").localeCompare(String(b.sourceName || "")))), (e) => console.error("Sources listener error:", e));
    const unsubAudit = onSnapshot(collection(db, "audit"), (snap) => setAudit(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDateSafe(b.time)?.getTime?.() || 0) - (toDateSafe(a.time)?.getTime?.() || 0))), (e) => console.error("Audit listener error:", e));
    return () => { unsubBookings(); unsubCars(); unsubSources(); unsubAudit(); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "settings", "companyProfile");
    return onSnapshot(ref, (snap) => setCompanyProfile(snap.exists() ? { ...DEFAULT_COMPANY_PROFILE, ...(snap.data() || {}) } : DEFAULT_COMPANY_PROFILE), (e) => {
      console.error("Company profile listener error:", e);
      setCompanyProfile(DEFAULT_COMPANY_PROFILE);
    });
  }, [user]);
  useEffect(() => {
    if (!user || loadingRole || !can(role, "addSource") || sources.length > 0) return;
    setDoc(doc(db, "sources", "main-maalvila"), {
      sourceName: "MAALVILA",
      sourceType: "main",
      contactPerson: "",
      phone: companyProfile.companyPhone || "",
      email: companyProfile.companyEmail || "maalvilaent@gmail.com",
      address: companyProfile.companyAddress || "",
      active: true,
      createdAt: serverTimestamp(),
      createdBy: user?.uid || "",
      createdByEmail: user?.email || roleEmail || "",
    }).catch((e) => console.error("Could not seed default source:", e));
  }, [user, loadingRole, role, sources.length, roleEmail, companyProfile.companyPhone, companyProfile.companyEmail, companyProfile.companyAddress]);
  useEffect(() => {
    if (!paymentOpen || !paymentBooking?.id) {
      setPaymentHistory([]);
      return;
    }
    const qy = query(collection(db, "bookings", paymentBooking.id, "payments"), orderBy("paidAt", "desc"), limit(50));
    return onSnapshot(qy, (snap) => setPaymentHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error("Payment history listener error:", e));
  }, [paymentOpen, paymentBooking]);

  useEffect(() => {
    if (!supplierPaymentOpen || !supplierPaymentBooking?.id) {
      setSupplierPaymentHistory([]);
      return;
    }
    const qy = query(collection(db, "bookings", supplierPaymentBooking.id, "supplierPayments"), orderBy("paidAt", "desc"), limit(50));
    return onSnapshot(qy, (snap) => setSupplierPaymentHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error("Supplier payment history listener error:", e));
  }, [supplierPaymentOpen, supplierPaymentBooking]);

  const formItemsComputed = useMemo(() => bookingItems.map((item) => computeItemSplit({ ...item, clientVatMode: item.clientVatMode || getDefaultClientVatMode(companyProfile) }, [], cars)), [bookingItems, cars, companyProfile]);
  const formTotals = useMemo(() => computePricingTotals(formItemsComputed), [formItemsComputed]);
  const formVatSummary = useMemo(() => computeBookingVatSummaryFromItems(formItemsComputed), [formItemsComputed]);

  const customerDirectory = useMemo(() => {
    const map = new Map();
    const sortedBookings = [...bookings].sort((a, b) => (toDateSafe(b.createdAt)?.getTime?.() || 0) - (toDateSafe(a.createdAt)?.getTime?.() || 0));
    sortedBookings.forEach((b) => {
      const name = String(b.customer || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name,
          email: String(b.customerEmail || "").trim(),
          phone: String(b.customerPhone || "").trim(),
          preferredChannel: b.preferredChannel || "email",
          lastBookingId: b.id || "",
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [bookings]);

  const customerLedgerRows = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const name = String(b.customer || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const items = getBookingItems(b, cars);
      const totals = getBookingTotals(b, cars);
      const total = computeBookingTotalAmount(b, cars);
      const paid = clampMoney(b.amountPaid || 0);
      const balance = Math.max(0, total - paid);
      const recordDate = toDateSafe(b.updatedAt) || toDateSafe(b.createdAt) || toDateSafe(b.paymentUpdatedAt) || null;
      const existing = map.get(key) || {
        customerName: name,
        email: "",
        phone: "",
        preferredChannel: "email",
        totalBookings: 0,
        confirmedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
        vehicleLines: 0,
        totalClientNet: 0,
        totalPaid: 0,
        totalBalance: 0,
        totalAdminIncome: 0,
        totalSupplierPayable: 0,
        carNumbers: new Set(),
        routes: new Set(),
        lastBookingDate: null,
        lastBookingId: "",
        lastStatus: "",
      };
      existing.totalBookings += 1;
      if (b.status === "confirmed") existing.confirmedBookings += 1;
      else if (b.status === "cancelled") existing.cancelledBookings += 1;
      else existing.pendingBookings += 1;
      existing.vehicleLines += items.length;
      existing.totalClientNet += totals.totalNetClientAmount;
      existing.totalPaid += paid;
      existing.totalBalance += balance;
      existing.totalAdminIncome += totals.totalNetAdminIncome;
      existing.totalSupplierPayable += totals.totalNetSupplierPayable;
      items.forEach((i) => {
        if (i.carNumber) existing.carNumbers.add(i.carNumber);
        const route = `${i.travelFrom || "—"} → ${i.travelTo || "—"}`;
        if (route !== "— → —") existing.routes.add(route);
      });
      const existingTime = existing.lastBookingDate?.getTime?.() || 0;
      const newTime = recordDate?.getTime?.() || 0;
      if (!existing.lastBookingDate || newTime >= existingTime) {
        existing.lastBookingDate = recordDate;
        existing.lastBookingId = b.id || "";
        existing.lastStatus = b.status || "pending";
        existing.email = String(b.customerEmail || existing.email || "").trim();
        existing.phone = String(b.customerPhone || existing.phone || "").trim();
        existing.preferredChannel = b.preferredChannel || existing.preferredChannel || "email";
      }
      map.set(key, existing);
    }
    return Array.from(map.values()).map((row) => ({
      ...row,
      carNumbersText: Array.from(row.carNumbers).join(", "),
      routesText: Array.from(row.routes).join(" | "),
    })).sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [bookings, cars]);

  const filteredCustomerLedgerRows = useMemo(() => {
    const q = customerLedgerSearch.trim().toLowerCase();
    if (!q) return customerLedgerRows;
    return customerLedgerRows.filter((row) => [row.customerName, row.email, row.phone, row.carNumbersText, row.routesText].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [customerLedgerRows, customerLedgerSearch]);

  const customerLedgerSummary = useMemo(() => ({
    totalCustomers: customerLedgerRows.length,
    customersWithBalance: customerLedgerRows.filter((row) => row.totalBalance > 0).length,
    totalCustomerBalance: customerLedgerRows.reduce((sum, row) => sum + row.totalBalance, 0),
    totalCustomerNet: customerLedgerRows.reduce((sum, row) => sum + row.totalClientNet, 0),
  }), [customerLedgerRows]);

  const supplierLedgerRows = useMemo(() => {
    const map = new Map();

    for (const source of sources) {
      map.set(source.id, {
        sourceId: source.id,
        sourceName: source.sourceName || "Unknown supplier",
        sourceType: source.sourceType || "",
        contactPerson: source.contactPerson || "",
        phone: source.phone || "",
        email: source.email || "",
        address: source.address || "",
        carsCount: cars.filter((car) => car.sourceId === source.id).length,
        totalBookings: 0,
        confirmedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
        vehicleLines: 0,
        grossSupplier: 0,
        discountShare: 0,
        netPayable: 0,
        paid: 0,
        balance: 0,
        adminIncome: 0,
        paymentCount: 0,
        carNumbers: new Set(),
        carNames: new Set(),
        routes: new Set(),
        lastBookingDate: null,
      });
    }

    for (const booking of bookings) {
      const bookingItems = getBookingItems(booking, cars);
      const bookingDate = toDateSafe(booking.updatedAt) || toDateSafe(booking.createdAt) || null;

      for (const item of bookingItems) {
        if (!item.sourceId) continue;

        const current = map.get(item.sourceId) || {
          sourceId: item.sourceId,
          sourceName: item.sourceName || "Unknown supplier",
          sourceType: item.sourceType || "",
          contactPerson: "",
          phone: "",
          email: "",
          address: "",
          carsCount: 0,
          totalBookings: 0,
          confirmedBookings: 0,
          pendingBookings: 0,
          cancelledBookings: 0,
          vehicleLines: 0,
          grossSupplier: 0,
          discountShare: 0,
          netPayable: 0,
          paid: 0,
          balance: 0,
          adminIncome: 0,
          paymentCount: 0,
          carNumbers: new Set(),
          carNames: new Set(),
          routes: new Set(),
          lastBookingDate: null,
        };

        current.totalBookings += 1;
        if (booking.status === "confirmed") current.confirmedBookings += 1;
        else if (booking.status === "cancelled") current.cancelledBookings += 1;
        else current.pendingBookings += 1;

        current.vehicleLines += 1;
        current.carNumbers.add(item.carNumber || "");
        current.carNames.add(item.carName || "");
        current.routes.add(`${item.travelFrom || "—"} → ${item.travelTo || "—"}`);

        if (booking.status === "confirmed") {
          current.grossSupplier += clampMoney(item.grossSupplierAmount);
          current.discountShare += clampMoney(item.supplierDiscountShare);
          current.netPayable += clampMoney(item.netSupplierPayable);
          current.adminIncome += clampMoney(item.netAdminIncome);
        }

        if (bookingDate && (!current.lastBookingDate || bookingDate > current.lastBookingDate)) {
          current.lastBookingDate = bookingDate;
        }

        map.set(item.sourceId, current);
      }
    }

    for (const entry of audit) {
      if (entry?.documentType !== "supplier_payment") continue;
      const sourceId = entry.sourceId;
      if (!sourceId) continue;
      const current = map.get(sourceId);
      if (!current) continue;

      current.paid += clampMoney(entry.supplierPaymentAmount);
      current.paymentCount += 1;
      map.set(sourceId, current);
    }

    return Array.from(map.values()).map((row) => ({
      ...row,
      balance: Math.max(0, clampMoney(row.netPayable) - clampMoney(row.paid)),
      carNumbersText: Array.from(row.carNumbers).filter(Boolean).join(" | "),
      carNamesText: Array.from(row.carNames).filter(Boolean).join(" | "),
      routesText: Array.from(row.routes).filter(Boolean).join(" | "),
    })).sort((a, b) => b.balance - a.balance || b.netPayable - a.netPayable || String(a.sourceName).localeCompare(String(b.sourceName)));
  }, [sources, cars, bookings, audit]);

  const filteredSupplierLedgerRows = useMemo(() => {
    const q = supplierLedgerSearch.trim().toLowerCase();
    if (!q) return supplierLedgerRows;
    return supplierLedgerRows.filter((row) => [row.sourceName, row.sourceType, row.contactPerson, row.phone, row.email, row.carNumbersText, row.routesText].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [supplierLedgerRows, supplierLedgerSearch]);

  const supplierLedgerSummary = useMemo(() => ({
    totalSuppliers: supplierLedgerRows.length,
    suppliersWithBalance: supplierLedgerRows.filter((row) => row.balance > 0).length,
    totalSupplierPayable: supplierLedgerRows.reduce((sum, row) => sum + row.netPayable, 0),
    totalSupplierPaid: supplierLedgerRows.reduce((sum, row) => sum + row.paid, 0),
    totalSupplierBalance: supplierLedgerRows.reduce((sum, row) => sum + row.balance, 0),
  }), [supplierLedgerRows]);

  const carsKPI = useMemo(() => new Set([...cars.map((c) => c?.number).filter(Boolean), ...bookings.flatMap((b) => getBookingItems(b, cars).map((i) => i.carNumber).filter(Boolean))].map(String)).size, [cars, bookings]);
  const bookedVehicleLines = useMemo(() => bookings.reduce((s, b) => s + getBookingItems(b, cars).length, 0), [bookings, cars]);
  const confirmedTotals = useMemo(() => bookings.reduce((t, b) => {
    if (b.status !== "confirmed") return t;
    const totals = getBookingTotals(b, cars);
    return {
      client: t.client + totals.totalNetClientAmount,
      supplier: t.supplier + totals.totalNetSupplierPayable,
      admin: t.admin + totals.totalNetAdminIncome,
      discount: t.discount + totals.totalDiscountAmount,
    };
  }, { client: 0, supplier: 0, admin: 0, discount: 0 }), [bookings, cars]);
  const penaltyTotal = useMemo(() => bookings.reduce((t, b) => t + Number(b.penalty || 0), 0), [bookings]);
  const outstandingTotal = useMemo(() => bookings.reduce((s, b) => s + Math.max(0, computeBookingTotalAmount(b, cars) - clampMoney(b.amountPaid || 0)), 0), [bookings, cars]);
  const paidLast30Days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return bookings.reduce((s, b) => {
      const t = toDateSafe(b.paymentUpdatedAt);
      return (!t || t < start) ? s : s + clampMoney(b.amountPaid || 0);
    }, 0);
  }, [bookings]);
  const filteredBookings = useMemo(() => {
    const start = filterStartDate ? new Date(filterStartDate) : null;
    const end = filterEndDate ? new Date(filterEndDate) : null;
    return bookings.filter((b) => {
      const items = getBookingItems(b, cars);
      if (filterCar && !items.some((i) => String(i.carNumber) === String(filterCar))) return false;
      if (filterStatus && String(b.status) !== String(filterStatus)) return false;
      if (filterSource && !items.some((i) => String(i.sourceId || "") === String(filterSource))) return false;
      if (start || end) {
        const s = start || new Date("2000-01-01");
        const e = end || new Date("2100-12-31");
        if (!(b.selectedDates || []).some((d) => d >= s && d <= e)) return false;
      }
      return true;
    });
  }, [bookings, cars, filterCar, filterStatus, filterSource, filterStartDate, filterEndDate]);
  const statusPieData = useMemo(() => {
    const m = new Map();
    for (const b of bookings) {
      const s = b.status || "pending";
      m.set(s, (m.get(s) || 0) + 1);
    }
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [bookings]);
  const topCarsBarData = useMemo(() => {
    const counts = {};
    bookings.forEach((b) => getBookingItems(b, cars).forEach((item) => {
      const k = item.carNumber ? String(item.carNumber) : "(no car)";
      counts[k] = (counts[k] || 0) + 1;
    }));
    return Object.entries(counts).map(([carNo, count]) => {
      const car = cars.find((c) => String(c.number) === String(carNo));
      return { carNo, label: car ? `${car.name} (${carNo})` : carNo, count };
    }).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [bookings, cars]);
  const last90Range = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 89);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, []);
  const revenueTrendData = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      if (b.status !== "confirmed") continue;
      const totals = getBookingTotals(b, cars);
      const amt = Number(totals.totalNetClientAmount || 0);
      if (!amt) continue;
      const dates = normalizeSelectedDates(b.selectedDates);
      const anchor = dates.find((d) => d >= last90Range.start && d <= last90Range.end) || toDateSafe(b.createdAt) || dates[0] || null;
      if (!anchor || anchor < last90Range.start || anchor > last90Range.end) continue;
      const key = trendMode === "quarterly" ? getQuarterLabel(anchor) : getMonthLabel(anchor);
      map.set(key, (map.get(key) || 0) + amt);
    }
    const keys = [];
    const cur = new Date(last90Range.start);
    const seen = new Set();
    while (cur <= last90Range.end) {
      const k = trendMode === "quarterly" ? getQuarterLabel(cur) : getMonthLabel(cur);
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
      cur.setMonth(cur.getMonth() + 1);
    }
    return keys.map((k) => ({ period: k, revenue: Number(map.get(k) || 0) }));
  }, [bookings, cars, trendMode, last90Range]);
  const utilizationTopCars = useMemo(() => {
    const m = new Map();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      for (const item of getBookingItems(b, cars)) {
        if (!item.carNumber) continue;
        const set = m.get(String(item.carNumber)) || new Set();
        for (const d of normalizeSelectedDates(b.selectedDates)) if (d >= last90Range.start && d <= last90Range.end) set.add(toISODateString(d));
        m.set(String(item.carNumber), set);
      }
    }
    return Array.from(m.entries()).map(([carNo, set]) => {
      const car = cars.find((c) => String(c.number) === String(carNo));
      return { carNo, label: car ? `${car.name} (${carNo})` : carNo, bookedDays: set.size };
    }).sort((a, b) => b.bookedDays - a.bookedDays).slice(0, 10);
  }, [bookings, cars, last90Range]);
  const topCustomers = useMemo(() => {
    const m = new Map();
    for (const b of bookings) {
      if (b.status !== "confirmed") continue;
      const name = (b.customer || "(unknown)").trim();
      m.set(name, (m.get(name) || 0) + getBookingTotals(b, cars).totalNetClientAmount);
    }
    return Array.from(m.entries()).map(([customerName, total]) => ({ customerName, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [bookings, cars]);
  const sourceSummary = useMemo(() => {
    const m = new Map();
    for (const s of sources) m.set(s.id, { sourceId: s.id, sourceName: s.sourceName || "", sourceType: s.sourceType || "", contactPerson: s.contactPerson || "", phone: s.phone || "", email: s.email || "", cars: 0, bookings: 0, vehicleLines: 0, grossSupplier: 0, netSupplierPayable: 0, adminIncome: 0 });
    for (const c of cars) {
      if (!c.sourceId) continue;
      const r = m.get(c.sourceId) || { sourceId: c.sourceId, sourceName: c.sourceName || "", sourceType: c.sourceType || "", contactPerson: "", phone: "", email: "", cars: 0, bookings: 0, vehicleLines: 0, grossSupplier: 0, netSupplierPayable: 0, adminIncome: 0 };
      r.cars += 1;
      m.set(c.sourceId, r);
    }
    for (const b of bookings) {
      const seenSources = new Set();
      for (const item of getBookingItems(b, cars)) {
        if (!item.sourceId) continue;
        const r = m.get(item.sourceId) || { sourceId: item.sourceId, sourceName: item.sourceName || "", sourceType: item.sourceType || "", contactPerson: "", phone: "", email: "", cars: 0, bookings: 0, vehicleLines: 0, grossSupplier: 0, netSupplierPayable: 0, adminIncome: 0 };
        r.vehicleLines += 1;
        if (!seenSources.has(item.sourceId)) {
          r.bookings += 1;
          seenSources.add(item.sourceId);
        }
        if (b.status === "confirmed") {
          r.grossSupplier += item.grossSupplierAmount;
          r.netSupplierPayable += item.netSupplierPayable;
          r.adminIncome += item.netAdminIncome;
        }
        m.set(item.sourceId, r);
      }
    }
    return Array.from(m.values()).sort((a, b) => String(a.sourceName || "").localeCompare(String(b.sourceName || "")));
  }, [sources, cars, bookings]);

  const duplicateCarNumberGroups = useMemo(() => {
    const groups = new Map();
    for (const car of cars) {
      const normalized = normalizeCarNumber(car.number);
      if (!normalized) continue;
      const existing = groups.get(normalized) || [];
      existing.push(car);
      groups.set(normalized, existing);
    }
    return Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([normalizedNumber, group]) => ({ normalizedNumber, group }));
  }, [cars]);

  const unassignedCars = useMemo(() => {
    return cars.filter((car) => !car.sourceId || !sources.some((source) => source.id === car.sourceId));
  }, [cars, sources]);

  const clientBalanceRows = useMemo(() => {
    return bookings
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => {
        const total = computeBookingTotalAmount(booking, cars);
        const paid = clampMoney(booking.amountPaid || 0);
        const balance = Math.max(0, total - paid);
        const items = getBookingItems(booking, cars);
        return {
          bookingId: booking.id,
          customer: booking.customer || "Unknown customer",
          status: booking.status || "pending",
          total,
          paid,
          balance,
          paymentStatus: booking.paymentStatus || computePaymentStatus(total, paid),
          dates: computeBookingDateSummary(items).map(toISODateString).join(", "),
          vehicles: items.map((item) => `${item.carName || "Vehicle"} (${item.carNumber || "—"})`).join(" | "),
        };
      })
      .sort((a, b) => b.balance - a.balance);
  }, [bookings, cars]);

  const supplierPayableRows = useMemo(() => {
    const map = new Map();
    for (const booking of bookings) {
      if (booking.status !== "confirmed") continue;
      for (const item of getBookingItems(booking, cars)) {
        if (!item.sourceId) continue;
        const current = map.get(item.sourceId) || {
          sourceId: item.sourceId,
          sourceName: item.sourceName || "Unknown supplier",
          sourceType: item.sourceType || "",
          vehicleLines: 0,
          grossSupplier: 0,
          discountShare: 0,
          netPayable: 0,
          adminIncome: 0,
        };
        current.vehicleLines += 1;
        current.grossSupplier += clampMoney(item.grossSupplierAmount);
        current.discountShare += clampMoney(item.supplierDiscountShare);
        current.netPayable += clampMoney(item.netSupplierPayable);
        current.adminIncome += clampMoney(item.netAdminIncome);
        map.set(item.sourceId, current);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.netPayable - a.netPayable);
  }, [bookings, cars]);

  const monthlyRevenueRows = useMemo(() => {
    const map = new Map();
    for (const booking of bookings) {
      if (booking.status !== "confirmed") continue;
      const created = toDateSafe(booking.createdAt) || toDateSafe(booking.updatedAt) || new Date();
      const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      const totals = getBookingTotals(booking, cars);
      const current = map.get(monthKey) || { monthKey, bookings: 0, clientNet: 0, supplierPayable: 0, adminIncome: 0 };
      current.bookings += 1;
      current.clientNet += clampMoney(totals.totalNetClientAmount);
      current.supplierPayable += clampMoney(totals.totalNetSupplierPayable);
      current.adminIncome += clampMoney(totals.totalNetAdminIncome);
      map.set(monthKey, current);
    }
    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [bookings, cars]);

  const reportsSummary = useMemo(() => {
    return {
      clientOutstanding: clientBalanceRows.reduce((sum, row) => sum + row.balance, 0),
      overdueLikeCount: clientBalanceRows.filter((row) => row.balance > 0 && row.status === "confirmed").length,
      supplierPayable: supplierPayableRows.reduce((sum, row) => sum + row.netPayable, 0),
      monthlyClientNet: monthlyRevenueRows.reduce((sum, row) => sum + row.clientNet, 0),
    };
  }, [clientBalanceRows, supplierPayableRows, monthlyRevenueRows]);

  const exportReportsCSV = () => {
    const rows = [
      ["REPORT", "NAME", "STATUS", "AMOUNT_1", "AMOUNT_2", "AMOUNT_3", "NOTES"],
      ...clientBalanceRows.map((row) => ["Client Balance", row.customer, row.paymentStatus, row.total, row.paid, row.balance, `${row.vehicles} | ${row.dates}`]),
      ...supplierPayableRows.map((row) => ["Supplier Payable", row.sourceName, row.sourceType, row.grossSupplier, row.discountShare, row.netPayable, `${row.vehicleLines} vehicle lines`]),
      ...monthlyRevenueRows.map((row) => ["Monthly Revenue", row.monthKey, "confirmed", row.clientNet, row.supplierPayable, row.adminIncome, `${row.bookings} bookings`]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_management_reports_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportCustomerLedgerCSV = () => {
    const rows = [
      ["CUSTOMER", "EMAIL", "PHONE", "CHANNEL", "BOOKINGS", "CONFIRMED", "PENDING", "CANCELLED", "VEHICLE_LINES", "CLIENT_NET", "PAID", "BALANCE", "ADMIN_INCOME", "SUPPLIER_PAYABLE", "CARS", "ROUTES", "LAST_BOOKING_DATE"],
      ...filteredCustomerLedgerRows.map((row) => [row.customerName, row.email, row.phone, row.preferredChannel, row.totalBookings, row.confirmedBookings, row.pendingBookings, row.cancelledBookings, row.vehicleLines, row.totalClientNet, row.totalPaid, row.totalBalance, row.totalAdminIncome, row.totalSupplierPayable, row.carNumbersText, row.routesText, row.lastBookingDate ? toISODateString(row.lastBookingDate) : ""]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_customer_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportSupplierLedgerCSV = () => {
    const rows = [
      ["SUPPLIER", "TYPE", "CONTACT_PERSON", "PHONE", "EMAIL", "CARS_COUNT", "BOOKINGS", "CONFIRMED", "PENDING", "CANCELLED", "VEHICLE_LINES", "GROSS_SUPPLIER", "DISCOUNT_SHARE", "NET_PAYABLE", "PAID", "BALANCE", "ADMIN_INCOME", "PAYMENT_COUNT", "CARS", "ROUTES", "LAST_BOOKING_DATE"],
      ...filteredSupplierLedgerRows.map((row) => [row.sourceName, sourceTypeLabel(row.sourceType), row.contactPerson, row.phone, row.email, row.carsCount, row.totalBookings, row.confirmedBookings, row.pendingBookings, row.cancelledBookings, row.vehicleLines, row.grossSupplier, row.discountShare, row.netPayable, row.paid, row.balance, row.adminIncome, row.paymentCount, row.carNumbersText, row.routesText, row.lastBookingDate ? toISODateString(row.lastBookingDate) : ""]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_supplier_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const availabilityRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 29);

    return cars.map((car) => {
      const bookedDateKeys = new Set();
      const futureLines = [];

      for (const booking of bookings) {
        if (booking.status === "cancelled") continue;
        const items = getBookingItems(booking, cars);
        for (const item of items) {
          if (String(item.carNumber || "") !== String(car.number || "")) continue;
          const dates = normalizeSelectedDates(item.selectedDates);
          const upcomingDates = dates.filter((d) => d >= today && d <= horizon);
          for (const d of upcomingDates) bookedDateKeys.add(toISODateString(d));
          const futureDates = dates.filter((d) => d >= today);
          if (futureDates.length) {
            futureLines.push({
              bookingId: booking.id,
              customer: booking.customer || "Unknown customer",
              status: booking.status || "pending",
              sourceName: item.sourceName || car.sourceName || "—",
              route: `${item.travelFrom || "—"} → ${item.travelTo || "—"}`,
              dates: futureDates,
              firstDate: futureDates[0],
            });
          }
        }
      }

      futureLines.sort((a, b) => a.firstDate - b.firstDate);
      const nextBooking = futureLines[0] || null;
      const bookedDaysNext30 = bookedDateKeys.size;
      const freeDaysNext30 = Math.max(0, 30 - bookedDaysNext30);

      return {
        carName: car.name || "Unnamed vehicle",
        carNumber: car.number || "—",
        sourceName: car.sourceName || "—",
        sourceType: car.sourceType || "",
        bookedDaysNext30,
        freeDaysNext30,
        status: bookedDaysNext30 >= 30 ? "Fully booked" : bookedDaysNext30 > 0 ? "Partly booked" : "Free",
        nextBooking,
        futureLines,
      };
    }).sort((a, b) => b.bookedDaysNext30 - a.bookedDaysNext30 || String(a.carNumber).localeCompare(String(b.carNumber)));
  }, [cars, bookings]);

  const upcomingBookingsByDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = [];

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      for (const item of getBookingItems(booking, cars)) {
        const dates = normalizeSelectedDates(item.selectedDates).filter((d) => d >= today);
        for (const d of dates) {
          rows.push({
            date: d,
            dateKey: toISODateString(d),
            customer: booking.customer || "Unknown customer",
            carName: item.carName || "Vehicle",
            carNumber: item.carNumber || "—",
            route: `${item.travelFrom || "—"} → ${item.travelTo || "—"}`,
            sourceName: item.sourceName || "—",
            status: booking.status || "pending",
          });
        }
      }
    }

    return rows.sort((a, b) => a.date - b.date).slice(0, 40);
  }, [bookings, cars]);

  const dispatchRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 13);
    const rows = [];

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      for (const item of getBookingItems(booking, cars)) {
        const allDates = normalizeSelectedDates(item.selectedDates);
        const dispatchDates = allDates.filter((d) => d >= today && d <= horizon);
        if (!dispatchDates.length) continue;

        rows.push({
          key: `${booking.id || "booking"}-${item.itemId || item.carNumber || "line"}-${toISODateString(dispatchDates[0])}`,
          bookingId: booking.id,
          customer: booking.customer || "Unknown customer",
          customerPhone: booking.customerPhone || "",
          customerEmail: booking.customerEmail || "",
          carName: item.carName || "Vehicle",
          carNumber: item.carNumber || "—",
          sourceName: item.sourceName || "—",
          sourceType: item.sourceType || "",
          route: `${item.travelFrom || "—"} → ${item.travelTo || "—"}`,
          driver: item.driver || item.confirmedDriverName || item.supplierConfirmedDriverName || "—",
          driverPhone: item.driverPhone || item.confirmedDriverPhone || item.supplierConfirmedDriverPhone || "",
          status: booking.status || "pending",
          firstDate: dispatchDates[0],
          lastDate: dispatchDates[dispatchDates.length - 1],
          dispatchDates,
          days: dispatchDates.length,
          supplierResponseStatus: item.supplierResponseStatus || item.responseStatus || "—",
        });
      }
    }

    return rows.sort((a, b) => a.firstDate - b.firstDate || String(a.carNumber).localeCompare(String(b.carNumber)));
  }, [bookings, cars]);

  const dispatchSummary = useMemo(() => {
    const confirmed = dispatchRows.filter((row) => row.status === "confirmed").length;
    const pending = dispatchRows.filter((row) => row.status === "pending").length;
    const uniqueCars = new Set(dispatchRows.map((row) => `${row.carNumber}-${row.sourceName}`)).size;
    const assignedDrivers = dispatchRows.filter((row) => row.driver && row.driver !== "—").length;
    return { totalTrips: dispatchRows.length, confirmed, pending, uniqueCars, assignedDrivers };
  }, [dispatchRows]);

  const exportDispatchCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    const rows = [
      ["Start Date", "End Date", "Days", "Customer", "Customer Phone", "Vehicle", "Car Number", "Route", "Driver", "Driver Phone", "Source", "Status", "Supplier Response"],
      ...dispatchRows.map((row) => [
        toISODateString(row.firstDate),
        toISODateString(row.lastDate),
        row.days,
        row.customer,
        row.customerPhone,
        row.carName,
        row.carNumber,
        row.route,
        row.driver,
        row.driverPhone,
        row.sourceName,
        row.status,
        row.supplierResponseStatus,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_dispatch_manifest_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const tripCloseoutRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 30);
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 14);
    const q = tripCloseoutSearch.trim().toLowerCase();
    const rows = [];

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      for (const item of getBookingItems(booking, cars)) {
        const allDates = normalizeSelectedDates(item.selectedDates);
        if (!allDates.length) continue;
        const firstDate = allDates[0];
        const lastDate = allDates[allDates.length - 1];
        if (lastDate < fromDate || firstDate > toDate) continue;

        const car = cars.find((c) => String(c.number) === String(item.carNumber));
        const key = `${booking.id || "booking"}-${item.itemId || item.carNumber || "line"}`;
        const draft = tripCloseoutDrafts[key] || {};
        const startKm = draft.startKm ?? item.dispatchStartKm ?? car?.currentOdometerKm ?? "";
        const endKm = draft.endKm ?? item.dispatchEndKm ?? "";
        const kmCovered = draft.kmCovered ?? item.dispatchKmCovered ?? (kmNumber(endKm) && kmNumber(startKm) ? Math.max(0, kmNumber(endKm) - kmNumber(startKm)) : "");
        const fuelCost = draft.fuelCost ?? item.dispatchFuelCost ?? "";
        const fuelBillingMode = draft.fuelBillingMode ?? item.dispatchFuelBillingMode ?? "client_paid_direct";
        const fuelReceiptRef = draft.fuelReceiptRef ?? item.dispatchFuelReceiptRef ?? "";
        const fuelReimbursedAmount = draft.fuelReimbursedAmount ?? item.dispatchFuelReimbursedAmount ?? "";
        const fuelReimbursementDate = draft.fuelReimbursementDate ?? item.dispatchFuelReimbursementDate ?? "";
        const fuelReimbursementRef = draft.fuelReimbursementRef ?? item.dispatchFuelReimbursementRef ?? "";
        const fuelReceivable = fuelBillingMode === "maalvila_reimbursable" ? clampMoney(fuelCost) : 0;
        const fuelReimbursed = fuelBillingMode === "maalvila_reimbursable" ? clampMoney(fuelReimbursedAmount) : 0;
        const fuelReceivableBalance = Math.max(0, fuelReceivable - fuelReimbursed);
        const fuelSettlementStatus = fuelBillingMode !== "maalvila_reimbursable" ? "Not applicable" : fuelReceivableBalance <= 0 && fuelReceivable > 0 ? "Reimbursed" : fuelReimbursed > 0 ? "Partly reimbursed" : "Awaiting reimbursement";
        const notes = draft.notes ?? item.dispatchCloseoutNotes ?? "";
        const isClosed = Boolean(item.dispatchClosed);
        const dueForCloseout = lastDate <= today && !isClosed;
        const statusLabel = isClosed ? "Closed" : dueForCloseout ? "Due for closeout" : "Upcoming";
        const searchText = [booking.customer, booking.customerPhone, item.carName, item.carNumber, item.travelFrom, item.travelTo, item.driver, item.driverPhone, item.sourceName, statusLabel].join(" ").toLowerCase();
        if (q && !searchText.includes(q)) continue;

        rows.push({
          key,
          booking,
          bookingId: booking.id,
          item,
          car,
          firstDate,
          lastDate,
          days: allDates.length,
          customer: booking.customer || "Unknown customer",
          customerPhone: booking.customerPhone || "",
          carName: item.carName || car?.name || "Vehicle",
          carNumber: item.carNumber || car?.number || "—",
          route: `${item.travelFrom || "—"} → ${item.travelTo || "—"}`,
          driver: item.driver || item.confirmedDriverName || item.supplierConfirmedDriverName || "—",
          driverPhone: item.driverPhone || item.confirmedDriverPhone || item.supplierConfirmedDriverPhone || "",
          sourceName: item.sourceName || car?.sourceName || "—",
          currentOdometerKm: car?.currentOdometerKm || "",
          startKm,
          endKm,
          kmCovered,
          fuelCost,
          fuelBillingMode,
          fuelReceiptRef,
          fuelReimbursedAmount,
          fuelReimbursementDate,
          fuelReimbursementRef,
          fuelReceivable,
          fuelReimbursed,
          fuelReceivableBalance,
          fuelSettlementStatus,
          notes,
          isClosed,
          dueForCloseout,
          statusLabel,
          statusClass: isClosed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : dueForCloseout ? "bg-red-50 text-red-700 border-red-200" : "bg-blue-50 text-blue-700 border-blue-200",
          bookingStatus: booking.status || "pending",
          dispatchCloseoutByEmail: item.dispatchCloseoutByEmail || "",
        });
      }
    }

    return rows.sort((a, b) => a.lastDate - b.lastDate || String(a.carNumber).localeCompare(String(b.carNumber)));
  }, [bookings, cars, tripCloseoutDrafts, tripCloseoutSearch]);

  const tripCloseoutSummary = useMemo(() => {
    const due = tripCloseoutRows.filter((r) => r.dueForCloseout).length;
    const closed = tripCloseoutRows.filter((r) => r.isClosed).length;
    const upcoming = tripCloseoutRows.filter((r) => !r.isClosed && !r.dueForCloseout).length;
    const totalKmCaptured = tripCloseoutRows.reduce((sum, r) => sum + kmNumber(r.kmCovered), 0);
    return { total: tripCloseoutRows.length, due, closed, upcoming, totalKmCaptured };
  }, [tripCloseoutRows]);

  const updateTripCloseoutDraft = (rowKey, patch) => {
    setTripCloseoutDrafts((prev) => ({ ...prev, [rowKey]: { ...(prev[rowKey] || {}), ...patch } }));
  };

  const saveTripCloseoutLine = async (row) => {
    if (!can(role, "editBooking") && !can(role, "maintenance")) return alert("You do not have permission to close out trips.");
    const start = kmNumber(row.startKm);
    const end = kmNumber(row.endKm);
    const covered = kmNumber(row.kmCovered) || (start && end ? Math.max(0, end - start) : 0);
    if (!start) return alert("Enter start odometer KM.");
    if (!end) return alert("Enter end odometer KM.");
    if (end < start) return alert("End odometer KM cannot be lower than start odometer KM.");

    const bookingItems = Array.isArray(row.booking.bookingItems) && row.booking.bookingItems.length
      ? row.booking.bookingItems
      : getBookingItems(row.booking, cars);

    const updatedItems = bookingItems.map((raw) => {
      const id = raw.itemId || row.item.itemId;
      if (String(id) !== String(row.item.itemId)) return raw;
      return {
        ...raw,
        dispatchStartKm: start,
        dispatchEndKm: end,
        dispatchKmCovered: covered,
        dispatchFuelCost: kmNumber(row.fuelCost) || "",
        dispatchFuelBillingMode: row.fuelBillingMode || "client_paid_direct",
        dispatchFuelReceiptRef: row.fuelReceiptRef || "",
        dispatchFuelReimbursedAmount: kmNumber(row.fuelReimbursedAmount) || "",
        dispatchFuelReimbursementDate: row.fuelReimbursementDate || "",
        dispatchFuelReimbursementRef: row.fuelReimbursementRef || "",
        dispatchCloseoutNotes: row.notes || "",
        dispatchClosed: true,
        dispatchCloseoutAt: new Date().toISOString(),
        dispatchCloseoutByEmail: user?.email || roleEmail || "",
      };
    });

    await updateDoc(doc(db, "bookings", row.bookingId), {
      bookingItems: updatedItems,
      dispatchCloseoutUpdatedAt: serverTimestamp(),
      dispatchCloseoutUpdatedByEmail: user?.email || roleEmail || "",
    });

    if (row.car?.id) {
      const currentStoredKm = kmNumber(row.car.currentOdometerKm);
      await updateDoc(doc(db, "cars", row.car.id), {
        currentOdometerKm: Math.max(currentStoredKm, end),
        lastTripKmCovered: covered,
        lastTripCloseoutAt: serverTimestamp(),
        lastTripCloseoutBookingId: row.bookingId,
        lastTripCloseoutCustomer: row.customer,
        maintenanceUpdatedAt: serverTimestamp(),
        maintenanceUpdatedByEmail: user?.email || roleEmail || "",
      });
    }

    await addDoc(collection(db, "audit"), {
      action: `Trip closeout captured: ${row.carName} (${row.carNumber}) for ${row.customer} - ${covered.toLocaleString()} km; fuel treatment: ${row.fuelBillingMode || "client_paid_direct"}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
      bookingId: row.bookingId,
      carNumber: row.carNumber,
      kmCovered: covered,
    });

    setTripCloseoutDrafts((prev) => {
      const next = { ...prev };
      delete next[row.key];
      return next;
    });

    alert("Trip closeout saved and vehicle odometer updated.");
  };

  const exportTripCloseoutCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    const rows = [
      ["Trip Start", "Trip End", "Customer", "Vehicle", "Car Number", "Route", "Driver", "Source", "Status", "Start KM", "End KM", "KM Covered", "Fuel Cost", "Fuel Treatment", "Fuel Receipt Ref", "Fuel Reimbursed", "Fuel Reimbursement Date", "Fuel Reimbursement Ref", "Fuel Receivable Balance", "Fuel Settlement Status", "Notes"],
      ...tripCloseoutRows.map((row) => [
        toISODateString(row.firstDate),
        toISODateString(row.lastDate),
        row.customer,
        row.carName,
        row.carNumber,
        row.route,
        row.driver,
        row.sourceName,
        row.statusLabel,
        row.startKm,
        row.endKm,
        row.kmCovered,
        row.fuelCost,
        row.fuelBillingMode,
        row.fuelReceiptRef,
        row.fuelReimbursedAmount,
        row.fuelReimbursementDate,
        row.fuelReimbursementRef,
        row.fuelReceivableBalance,
        row.fuelSettlementStatus,
        row.notes,
      ]),
    ];
    const csv = rows.map((cells) => cells.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_trip_closeout_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const tripProfitabilityRows = useMemo(() => {
    const q = profitabilitySearch.trim().toLowerCase();
    const rows = [];
    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      for (const item of getBookingItems(booking, cars)) {
        const dates = normalizeSelectedDates(item.selectedDates);
        const firstDate = dates[0] || null;
        const lastDate = dates[dates.length - 1] || null;
        const clientNet = clampMoney(item.netClientAmount);
        const supplierPayable = clampMoney(item.netSupplierPayable);
        const adminIncome = clampMoney(item.netAdminIncome);
        const fuelCost = clampMoney(item.dispatchFuelCost);
        const fuelBillingMode = item.dispatchFuelBillingMode || "client_paid_direct";
        const fuelReimbursed = fuelBillingMode === "maalvila_reimbursable" ? clampMoney(item.dispatchFuelReimbursedAmount) : 0;
        const fuelCostToProfit = fuelBillingMode === "maalvila_absorbed" ? fuelCost : 0;
        const fuelReceivable = fuelBillingMode === "maalvila_reimbursable" ? fuelCost : 0;
        const fuelReceivableBalance = Math.max(0, fuelReceivable - fuelReimbursed);
        const fuelSettlementStatus = fuelBillingMode !== "maalvila_reimbursable" ? "Not applicable" : fuelReceivableBalance <= 0 && fuelReceivable > 0 ? "Reimbursed" : fuelReimbursed > 0 ? "Partly reimbursed" : "Awaiting reimbursement";
        const kmCovered = clampMoney(item.dispatchKmCovered);
        const grossMargin = clientNet - supplierPayable;
        const tripProfit = clientNet - supplierPayable - fuelCostToProfit;
        const profitMarginPct = clientNet > 0 ? (tripProfit / clientNet) * 100 : 0;
        const profitPerKm = kmCovered > 0 ? tripProfit / kmCovered : 0;
        const statusLabel = tripProfit < 0 ? "Loss" : item.dispatchClosed ? "Closed with profit" : "Awaiting closeout";
        const searchText = [booking.customer, booking.customerPhone, item.carName, item.carNumber, item.travelFrom, item.travelTo, item.driver, item.sourceName, statusLabel].join(" ").toLowerCase();
        if (q && !searchText.includes(q)) continue;
        rows.push({
          key: `${booking.id || "booking"}-${item.itemId || item.carNumber || "line"}`,
          bookingId: booking.id,
          customer: booking.customer || "Unknown customer",
          customerPhone: booking.customerPhone || "",
          carName: item.carName || "Vehicle",
          carNumber: item.carNumber || "—",
          route: `${item.travelFrom || "—"} → ${item.travelTo || "—"}`,
          driver: item.driver || item.confirmedDriverName || item.supplierConfirmedDriverName || "—",
          sourceName: item.sourceName || "—",
          firstDate,
          lastDate,
          days: dates.length,
          clientNet,
          supplierPayable,
          adminIncome,
          fuelCost,
          fuelBillingMode,
          fuelCostToProfit,
          fuelReceivable,
          fuelReimbursed,
          fuelReceivableBalance,
          fuelSettlementStatus,
          fuelReceiptRef: item.dispatchFuelReceiptRef || "",
          fuelReimbursementDate: item.dispatchFuelReimbursementDate || "",
          fuelReimbursementRef: item.dispatchFuelReimbursementRef || "",
          kmCovered,
          grossMargin,
          tripProfit,
          profitMarginPct,
          profitPerKm,
          statusLabel,
          statusClass: tripProfit < 0 ? "bg-red-50 text-red-700 border-red-200" : item.dispatchClosed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200",
          bookingStatus: booking.status || "pending",
        });
      }
    }
    return rows.sort((a, b) => (b.tripProfit - a.tripProfit) || String(a.customer).localeCompare(String(b.customer)));
  }, [bookings, cars, profitabilitySearch]);

  const tripProfitabilitySummary = useMemo(() => {
    const totalClientNet = tripProfitabilityRows.reduce((sum, r) => sum + r.clientNet, 0);
    const totalSupplierPayable = tripProfitabilityRows.reduce((sum, r) => sum + r.supplierPayable, 0);
    const totalFuelCost = tripProfitabilityRows.reduce((sum, r) => sum + r.fuelCost, 0);
    const totalFuelCostToProfit = tripProfitabilityRows.reduce((sum, r) => sum + r.fuelCostToProfit, 0);
    const totalFuelReceivable = tripProfitabilityRows.reduce((sum, r) => sum + r.fuelReceivable, 0);
    const totalFuelReimbursed = tripProfitabilityRows.reduce((sum, r) => sum + r.fuelReimbursed, 0);
    const totalFuelReceivableBalance = tripProfitabilityRows.reduce((sum, r) => sum + r.fuelReceivableBalance, 0);
    const totalProfit = tripProfitabilityRows.reduce((sum, r) => sum + r.tripProfit, 0);
    const lossTrips = tripProfitabilityRows.filter((r) => r.tripProfit < 0).length;
    const awaitingCloseout = tripProfitabilityRows.filter((r) => r.statusLabel === "Awaiting closeout").length;
    return { totalTrips: tripProfitabilityRows.length, totalClientNet, totalSupplierPayable, totalFuelCost, totalFuelCostToProfit, totalFuelReceivable, totalFuelReimbursed, totalFuelReceivableBalance, totalProfit, lossTrips, awaitingCloseout };
  }, [tripProfitabilityRows]);

  const exportTripProfitabilityCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    const rows = [
      ["Customer", "Vehicle", "Car Number", "Route", "Driver", "Source", "First Date", "Last Date", "Days", "Client Net", "Supplier Payable", "Admin Income", "Fuel Treatment", "Fuel Captured", "Fuel Cost to MAALVILA", "Fuel Receivable", "Fuel Reimbursed", "Fuel Receivable Balance", "Fuel Settlement Status", "Fuel Receipt Ref", "Fuel Reimbursement Date", "Fuel Reimbursement Ref", "KM Covered", "Gross Margin", "Trip Profit", "Profit Margin %", "Profit per KM", "Status"],
      ...tripProfitabilityRows.map((r) => [
        r.customer,
        r.carName,
        r.carNumber,
        r.route,
        r.driver,
        r.sourceName,
        r.firstDate ? toISODateString(r.firstDate) : "",
        r.lastDate ? toISODateString(r.lastDate) : "",
        r.days,
        r.clientNet,
        r.supplierPayable,
        r.adminIncome,
        r.fuelBillingMode,
        r.fuelCost,
        r.fuelCostToProfit,
        r.fuelReceivable,
        r.fuelReimbursed,
        r.fuelReceivableBalance,
        r.fuelSettlementStatus,
        r.fuelReceiptRef,
        r.fuelReimbursementDate,
        r.fuelReimbursementRef,
        r.kmCovered,
        r.grossMargin,
        r.tripProfit,
        r.profitMarginPct.toFixed(2),
        r.profitPerKm.toFixed(2),
        r.statusLabel,
      ]),
    ];
    const csv = rows.map((cells) => cells.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_trip_profitability_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const fuelClaimsRows = useMemo(() => {
    const q = fuelClaimsSearch.trim().toLowerCase();
    return tripProfitabilityRows
      .filter((row) => row.fuelBillingMode === "maalvila_reimbursable" && row.fuelReceivable > 0)
      .filter((row) => {
        const searchText = [
          row.customer,
          row.customerPhone,
          row.carName,
          row.carNumber,
          row.route,
          row.driver,
          row.sourceName,
          row.fuelReceiptRef,
          row.fuelReimbursementRef,
          row.fuelSettlementStatus,
        ].join(" ").toLowerCase();
        return !q || searchText.includes(q);
      })
      .sort((a, b) => {
        const balanceDiff = (b.fuelReceivableBalance || 0) - (a.fuelReceivableBalance || 0);
        if (balanceDiff !== 0) return balanceDiff;
        return String(a.customer).localeCompare(String(b.customer));
      });
  }, [tripProfitabilityRows, fuelClaimsSearch]);

  const fuelClaimsSummary = useMemo(() => {
    const totalClaims = fuelClaimsRows.length;
    const totalReceivable = fuelClaimsRows.reduce((sum, row) => sum + row.fuelReceivable, 0);
    const totalReimbursed = fuelClaimsRows.reduce((sum, row) => sum + row.fuelReimbursed, 0);
    const totalBalance = fuelClaimsRows.reduce((sum, row) => sum + row.fuelReceivableBalance, 0);
    const openClaims = fuelClaimsRows.filter((row) => row.fuelReceivableBalance > 0).length;
    const settledClaims = fuelClaimsRows.filter((row) => row.fuelReceivableBalance <= 0).length;
    return { totalClaims, totalReceivable, totalReimbursed, totalBalance, openClaims, settledClaims };
  }, [fuelClaimsRows]);

  const exportFuelClaimsCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    const rows = [
      ["Customer", "Vehicle", "Car Number", "Route", "Driver", "Source", "First Date", "Last Date", "Fuel Receipt Ref", "Fuel Receivable", "Fuel Reimbursed", "Fuel Balance", "Reimbursement Date", "Reimbursement Ref", "Settlement Status"],
      ...fuelClaimsRows.map((row) => [
        row.customer,
        row.carName,
        row.carNumber,
        row.route,
        row.driver,
        row.sourceName,
        row.firstDate ? toISODateString(row.firstDate) : "",
        row.lastDate ? toISODateString(row.lastDate) : "",
        row.fuelReceiptRef,
        row.fuelReceivable,
        row.fuelReimbursed,
        row.fuelReceivableBalance,
        row.fuelReimbursementDate,
        row.fuelReimbursementRef,
        row.fuelSettlementStatus,
      ]),
    ];
    const csv = rows.map((cells) => cells.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_fuel_claims_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const getMaintenanceDraft = (car) => ({
    currentOdometerKm: maintenanceDrafts[car.id]?.currentOdometerKm ?? car.currentOdometerKm ?? "",
    lastServiceKm: maintenanceDrafts[car.id]?.lastServiceKm ?? car.lastServiceKm ?? "",
    serviceIntervalKm: maintenanceDrafts[car.id]?.serviceIntervalKm ?? car.serviceIntervalKm ?? "5000",
    nextServiceKm: maintenanceDrafts[car.id]?.nextServiceKm ?? car.nextServiceKm ?? "",
    lastServiceDate: maintenanceDrafts[car.id]?.lastServiceDate ?? car.lastServiceDate ?? "",
    nextServiceDate: maintenanceDrafts[car.id]?.nextServiceDate ?? car.nextServiceDate ?? "",
    insuranceExpiry: maintenanceDrafts[car.id]?.insuranceExpiry ?? car.insuranceExpiry ?? "",
    roadworthyExpiry: maintenanceDrafts[car.id]?.roadworthyExpiry ?? car.roadworthyExpiry ?? "",
    maintenanceNotes: maintenanceDrafts[car.id]?.maintenanceNotes ?? car.maintenanceNotes ?? "",
  });
  const updateMaintenanceDraft = (carId, patch) => setMaintenanceDrafts((prev) => ({ ...prev, [carId]: { ...(prev[carId] || {}), ...patch } }));
  const saveMaintenanceForCar = async (car) => {
    if (!can(role, "maintenance")) return alert("Only Admin can update maintenance and compliance records.");
    const draft = getMaintenanceDraft(car);
    await updateDoc(doc(db, "cars", car.id), {
      currentOdometerKm: kmNumber(draft.currentOdometerKm) || "",
      lastServiceKm: kmNumber(draft.lastServiceKm) || "",
      serviceIntervalKm: kmNumber(draft.serviceIntervalKm) || 5000,
      nextServiceKm: kmNumber(draft.nextServiceKm) || "",
      lastServiceDate: draft.lastServiceDate || "",
      nextServiceDate: draft.nextServiceDate || "",
      insuranceExpiry: draft.insuranceExpiry || "",
      roadworthyExpiry: draft.roadworthyExpiry || "",
      maintenanceNotes: draft.maintenanceNotes || "",
      maintenanceUpdatedAt: serverTimestamp(),
      maintenanceUpdatedBy: user?.uid || "",
      maintenanceUpdatedByEmail: user?.email || roleEmail || "",
    });
    await addDoc(collection(db, "audit"), { action: `Maintenance updated: ${car.name || "Vehicle"} (${car.number || "No number"})`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), carId: car.id, carNumber: car.number || "" });
    setMaintenanceDrafts((prev) => {
      const next = { ...prev };
      delete next[car.id];
      return next;
    });
  };
  const maintenanceRows = useMemo(() => {
    const q = maintenanceSearch.trim().toLowerCase();
    return cars.map((car, idx) => {
      const draft = getMaintenanceDraft(car);
      const row = {
        ...car,
        rowKey: `${car.id || car.number || "car"}-${idx}`,
        currentOdometerKm: draft.currentOdometerKm,
        lastServiceKm: draft.lastServiceKm,
        serviceIntervalKm: draft.serviceIntervalKm,
        nextServiceKm: draft.nextServiceKm,
        lastServiceDate: draft.lastServiceDate,
        nextServiceDate: draft.nextServiceDate,
        insuranceExpiry: draft.insuranceExpiry,
        roadworthyExpiry: draft.roadworthyExpiry,
        maintenanceNotes: draft.maintenanceNotes,
        kmServiceStatus: kmServiceStatus(draft),
        dateServiceStatus: complianceStatus(draft.nextServiceDate, 14),
        insuranceStatus: complianceStatus(draft.insuranceExpiry, 30),
        roadworthyStatus: complianceStatus(draft.roadworthyExpiry, 30),
      };
      row.overallStatus = maintenanceOverallStatus(row);
      return row;
    }).filter((row) => {
      if (!q) return true;
      return [row.name, row.number, row.sourceName, row.sourceType, row.currentOdometerKm, row.lastServiceKm, row.nextServiceKm, row.serviceIntervalKm, row.maintenanceNotes].some((value) => String(value || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const rank = { "Attention required": 0, Monitor: 1, Good: 2 };
      return (rank[a.overallStatus.label] ?? 3) - (rank[b.overallStatus.label] ?? 3) || String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [cars, maintenanceDrafts, maintenanceSearch]);
  const maintenanceSummary = useMemo(() => maintenanceRows.reduce((acc, row) => {
    acc.total += 1;
    if (row.overallStatus.label === "Attention required") acc.attention += 1;
    if (row.overallStatus.label === "Monitor") acc.monitor += 1;
    if (row.overallStatus.label === "Good") acc.good += 1;
    return acc;
  }, { total: 0, attention: 0, monitor: 0, good: 0 }), [maintenanceRows]);
  const exportMaintenanceCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    const rows = [
      ["Vehicle", "Car Number", "Source", "Overall Status", "Current Odometer KM", "Last Service KM", "KM Since Last Service", "Service Interval KM", "Next Service KM", "KM Remaining", "KM Service Status", "Last Service Date", "Next Service Date", "Date Service Status", "Insurance Expiry", "Insurance Status", "Roadworthy Expiry", "Roadworthy Status", "Notes"],
      ...maintenanceRows.map((row) => [row.name, row.number, row.sourceName, row.overallStatus.label, row.currentOdometerKm, row.lastServiceKm, row.kmServiceStatus.kmSinceService ?? "", row.serviceIntervalKm, row.kmServiceStatus.nextServiceKm || row.nextServiceKm, row.kmServiceStatus.remainingKm ?? "", row.kmServiceStatus.label, row.lastServiceDate, row.nextServiceDate, row.dateServiceStatus.label, row.insuranceExpiry, row.insuranceStatus.label, row.roadworthyExpiry, row.roadworthyStatus.label, row.maintenanceNotes]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    link.download = `maalvila_maintenance_tracker_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const sendEmailNotification = async ({ toEmail, subject, message, bookingId, actionType, meta }) => {
    if (!toEmail) return;
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toEmail, subject, message, bookingId: bookingId || "", actionType: actionType || "notify", userEmail: user?.email || roleEmail || "", meta: meta || {} }),
      });
      if (!res.ok) console.error("Notify failed:", res.status, await res.text());
    } catch (e) {
      console.error("Notify error:", e);
    }
  };
  const logout = async () => signOut(auth);
  const saveCompanyProfile = async () => {
    if (!can(role, "settings")) return alert("Only Admin can update company settings.");
    setSavingProfile(true);
    try {
      await setDoc(doc(db, "settings", "companyProfile"), { ...companyProfile, updatedAt: serverTimestamp(), updatedBy: user?.uid || "", updatedByEmail: user?.email || roleEmail || "" });
      await addDoc(collection(db, "audit"), { action: "Company profile/settings updated", userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
      alert("Company profile saved successfully.");
    } catch (e) {
      console.error(e);
      alert("Could not save company profile.");
    } finally {
      setSavingProfile(false);
    }
  };
  const addSource = async () => {
    if (!can(role, "addSource")) return alert("Only Admin can add sources.");
    if (!newSourceName.trim()) return alert("Enter source name.");
    if (sources.some((s) => String(s.sourceName || "").toLowerCase() === newSourceName.trim().toLowerCase())) return alert("This source already exists.");
    await addDoc(collection(db, "sources"), { sourceName: newSourceName.trim(), sourceType: newSourceType, contactPerson: newSourceContactPerson.trim(), phone: newSourcePhone.trim(), email: newSourceEmail.trim(), address: newSourceAddress.trim(), active: true, createdAt: serverTimestamp(), createdBy: user?.uid || "", createdByEmail: user?.email || roleEmail || "" });
    await addDoc(collection(db, "audit"), { action: `Source added: ${newSourceName.trim()} (${sourceTypeLabel(newSourceType)})`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    setNewSourceName(""); setNewSourceType("main"); setNewSourceContactPerson(""); setNewSourcePhone(""); setNewSourceEmail(""); setNewSourceAddress("");
  };
  const addCar = async () => {
    if (!can(role, "addCar")) return alert("Only Admin can add cars.");
    if (!newCarName || !newCarNumber) return alert("Fill car name and number.");
    if (!newCarSourceId) return alert("Select the source/company that owns or supplies this car.");
    const cleanedCarNumber = normalizeCarNumber(newCarNumber);
    if (!cleanedCarNumber) return alert("Enter a valid car number.");
    if (cars.some((c) => normalizeCarNumber(c.number) === cleanedCarNumber)) return alert(`Duplicate car number is not allowed: ${cleanedCarNumber}. Check Cars List before adding.`);
    const s = sources.find((x) => x.id === newCarSourceId);
    await addDoc(collection(db, "cars"), { name: newCarName.trim(), number: cleanedCarNumber, sourceId: s?.id || "", sourceName: s?.sourceName || "", sourceType: s?.sourceType || "main", createdAt: serverTimestamp(), createdBy: user?.uid || "", createdByEmail: user?.email || "" });
    await addDoc(collection(db, "audit"), { action: `Car added: ${newCarName.trim()} (${cleanedCarNumber}) — Source: ${s?.sourceName || "Unknown"}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    setNewCarName(""); setNewCarNumber(""); setNewCarSourceId("");
  };
  const resetBookingForm = () => {
    setCustomer(""); setCustomerEmail(""); setCustomerPhone(""); setTravelFrom(""); setTravelTo(""); setPreferredChannel("email"); setDriver(""); setDriverPhone(""); setSelectedDates([]); setBookingItems([{ ...blankBookingItem(), clientVatMode: getDefaultClientVatMode(companyProfile) }]); setEditBookingId(null);
  };
  const populateExistingCustomer = (selectedName) => {
    const value = String(selectedName || "");
    setCustomer(value);
    const match = customerDirectory.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
    if (!match) return;
    setCustomer(match.name || "");
    setCustomerEmail(match.email || "");
    setCustomerPhone(match.phone || "");
    setPreferredChannel(match.preferredChannel || "email");
  };
  const updateBookingItem = (itemId, patch) => setBookingItems((items) => items.map((item) => item.itemId === itemId ? { ...item, ...patch } : item));
  const addBookingItem = () => setBookingItems((items) => [...items, { ...blankBookingItem(), clientVatMode: getDefaultClientVatMode(companyProfile) }]);
  const removeBookingItem = (itemId) => setBookingItems((items) => items.length <= 1 ? items : items.filter((item) => item.itemId !== itemId));
  const validateBooking = () => {
    if (!customer) return "Fill customer name.";
    if (!bookingItems.length) return "Add at least one vehicle line.";
    for (const item of bookingItems) {
      const key = String(item.carNumber || "");
      if (!item.carNumber) return "Each vehicle line must have a selected car.";
      if (!String(item.travelFrom || "").trim()) return `Enter Travel From for car ${key}.`;
      if (!String(item.travelTo || "").trim()) return `Enter Travel To for car ${key}.`;
      const itemDates = normalizeSelectedDates(item.selectedDates);
      if (!itemDates.length) return `Select trip dates for car ${key}.`;
      if (!item.supplierRate && String(item.supplierRate) !== "0") return "Enter supplier rate for every vehicle line. Use 0 only for MAALVILA-owned internal fleet if appropriate.";
      if (!item.adminCharge && String(item.adminCharge) !== "0") return "Enter MAALVILA admin charge for every vehicle line.";
      if ((item.discountType || "none") === "percentage" && Number(item.discountValue || 0) > 100) return "Percentage discount cannot be above 100%. Use Fixed Amount (GHS) if you mean a cedi amount.";
      const pctTotal = Number(item.supplierDiscountSharePct || 0) + Number(item.adminDiscountSharePct || 0);
      if (Math.abs(pctTotal - 100) > 0.0001) return `Discount shares for car ${key} must add to 100%.`;
    }
    for (const item of bookingItems) {
      const newDates = normalizeSelectedDates(item.selectedDates);
      const conflictDetails = [];
      for (const b of bookings) {
        if (b.id === editBookingId || b.status === "cancelled") continue;
        for (const existingItem of getBookingItems(b, cars)) {
          if (String(existingItem.carNumber) !== String(item.carNumber)) continue;
          const existingDates = normalizeSelectedDates(existingItem.selectedDates);
          const overlap = existingDates
            .filter((ed) => newDates.some((sd) => sameDay(ed, sd)))
            .map(toISODateString);
          if (overlap.length) {
            conflictDetails.push({
              customer: b.customer || "Unknown customer",
              carName: existingItem.carName || item.carName || "Vehicle",
              carNumber: existingItem.carNumber || item.carNumber,
              dates: overlap,
            });
          }
        }
      }
      if (conflictDetails.length) {
        return [
          "Date conflict detected. Please adjust the affected booking line:",
          "",
          ...conflictDetails.map((c) => `${c.carName} (${c.carNumber}) is already booked for ${c.customer} on: ${c.dates.join(", ")}`),
        ].join("\n");
      }
    }
    return "";
  };
  const saveBooking = async () => {
    if (!can(role, "addBooking") && !can(role, "editBooking")) return alert("You do not have permission to add/edit bookings.");
    const error = validateBooking();
    if (error) return alert(error);
    const computedItems = bookingItems.map((item) => computeItemSplit({ ...item, clientVatMode: item.clientVatMode || getDefaultClientVatMode(companyProfile) }, [], cars));
    const normSelected = computeBookingDateSummary(computedItems);
    const pricingTotals = computePricingTotals(computedItems);
    const mainItem = computedItems[0] || {};
    const bookingData = {
      customer: customer.trim(),
      customerEmail: (customerEmail || "").trim(),
      customerPhone: (customerPhone || "").trim(),
      travelFrom: (mainItem.travelFrom || "").trim(),
      travelTo: (mainItem.travelTo || "").trim(),
      routeSummary: Array.from(new Set(computedItems.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | "),
      preferredChannel: preferredChannel || "email",
      driver: (mainItem.driver || "").trim(),
      driverPhone: (mainItem.driverPhone || "").trim(),
      selectedDates: normSelected,
      bookingItems: computedItems,
      pricingTotals,
      vehicleCount: computedItems.length,
      // Legacy compatibility fields for older views/export/search
      carNumber: mainItem.carNumber || "",
      carName: mainItem.carName || "",
      sourceId: mainItem.sourceId || "",
      sourceName: mainItem.sourceName || "",
      sourceType: mainItem.sourceType || "main",
      supplierRate: mainItem.supplierRate || 0,
      adminCharge: mainItem.adminCharge || 0,
      clientDailyRate: mainItem.clientDailyRate || 0,
      dailyRate: mainItem.clientDailyRate || 0,
      discountType: mainItem.discountType || "none",
      discountValue: mainItem.discountValue || 0,
      supplierDiscountSharePct: mainItem.supplierDiscountSharePct || 0,
      adminDiscountSharePct: mainItem.adminDiscountSharePct || 100,
      createdBy: user?.uid || "",
      createdByEmail: user?.email || roleEmail || "",
      updatedAt: serverTimestamp(),
    };
    if (editBookingId) {
      const current = bookings.find((b) => b.id === editBookingId) || {};
      const existingPaid = clampMoney(current.amountPaid || 0);
      const currentStatus = current.status || "pending";
      const updatedTotal = pricingTotals.totalNetClientAmount;
      await updateDoc(doc(db, "bookings", editBookingId), {
        ...bookingData,
        status: currentStatus,
        confirmedAmount: currentStatus === "confirmed" ? updatedTotal : Number(current.confirmedAmount || 0),
        penalty: currentStatus === "cancelled" ? Number(current.penalty || 0) : 0,
        amountPaid: existingPaid,
        paymentStatus: computePaymentStatus(updatedTotal, existingPaid),
        paymentUpdatedAt: current.paymentUpdatedAt || null,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "audit"), { action: `Multi-car booking updated for ${bookingData.customer} — Vehicles: ${computedItems.length} — Client net ${currencyGH(pricingTotals.totalNetClientAmount)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    } else {
      await addDoc(collection(db, "bookings"), {
        ...bookingData,
        status: "pending",
        confirmedAmount: 0,
        penalty: 0,
        amountPaid: 0,
        paymentStatus: "unpaid",
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, "audit"), { action: `Multi-car booking created for ${bookingData.customer} — Vehicles: ${computedItems.length} — Client net ${currencyGH(pricingTotals.totalNetClientAmount)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    }
    resetBookingForm();
  };
  const editBooking = (b) => {
    if (!can(role, "editBooking")) return alert("You do not have permission to edit bookings.");
    setCustomer(b.customer || ""); setCustomerEmail(b.customerEmail || ""); setCustomerPhone(b.customerPhone || ""); setTravelFrom(b.travelFrom || ""); setTravelTo(b.travelTo || ""); setPreferredChannel(b.preferredChannel || "email"); setDriver(b.driver || ""); setDriverPhone(b.driverPhone || ""); setSelectedDates(normalizeSelectedDates(b.selectedDates));
    setBookingItems(getBookingItems(b, cars).map((item) => ({ ...item, selectedDates: normalizeSelectedDates(item.selectedDates), travelFrom: item.travelFrom || b.travelFrom || "", travelTo: item.travelTo || b.travelTo || "", driver: item.driver || b.driver || "", driverPhone: item.driverPhone || b.driverPhone || "", supplierRate: String(item.supplierRate ?? ""), adminCharge: String(item.adminCharge ?? ""), discountValue: item.discountType === "none" ? "" : String(item.discountValue ?? ""), supplierDiscountSharePct: String(item.supplierDiscountSharePct ?? 50), adminDiscountSharePct: String(item.adminDiscountSharePct ?? 50), clientVatMode: item.clientVatMode || getDefaultClientVatMode(companyProfile) })));
    setEditBookingId(b.id);
    setActiveView("bookings");
  };
  const confirmBooking = async (b) => {
    if (!can(role, "confirmBooking")) return alert("Only Admin can confirm bookings.");
    const totals = getBookingTotals(b, cars);
    const amt = totals.totalNetClientAmount;
    await updateDoc(doc(db, "bookings", b.id), { status: "confirmed", confirmedAmount: amt, penalty: 0, pricingTotals: totals, updatedAt: serverTimestamp() });
    await addDoc(collection(db, "audit"), { action: `Booking confirmed (${b.customer}) — Vehicles: ${getBookingItems(b, cars).length} — Amount ${currencyGH(amt)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    await sendEmailNotification({ toEmail: b.customerEmail, bookingId: b.id, actionType: "booking_confirmed", subject: `Booking Confirmed - ${b.customer || "Customer"}`, message: `Hello ${b.customer || "Customer"},\n\nYour booking is CONFIRMED.\n\nVehicles: ${getBookingItems(b, cars).length}\nRoutes: ${Array.from(new Set(getBookingItems(b, cars).map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}\nDates: ${computeBookingDateSummary(getBookingItems(b, cars)).map(toISODateString).join(", ")}\nClient Net: ${currencyGH(amt)}\n\nThank you.` });
  };
  const cancelBooking = async (b) => {
    if (!can(role, "cancelBooking")) return alert("Only Admin can cancel bookings.");
    const base = getBookingTotals(b, cars).totalNetClientAmount;
    const penalty = b.status === "confirmed" ? base * 0.05 : 0;
    await updateDoc(doc(db, "bookings", b.id), { status: "cancelled", penalty, updatedAt: serverTimestamp() });
    await addDoc(collection(db, "audit"), { action: `Booking cancelled (${b.customer})${penalty ? ` — Penalty ${currencyGH(penalty)}` : ""}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
  };
  const exportCSV = () => {
    if (!can(role, "export")) return alert("You do not have permission to export.");
    if (!filteredBookings.length) return alert("No bookings to export.");
    const rows = filteredBookings.map((b) => {
      const items = getBookingItems(b, cars);
      const totals = getBookingTotals(b, cars);
      const totalAmount = computeBookingTotalAmount(b, cars);
      const amountPaid = clampMoney(b.amountPaid || 0);
      const balance = Math.max(0, totalAmount - amountPaid);
      const payStatus = b.paymentStatus || computePaymentStatus(totalAmount, amountPaid);
      return {
        Customer: (b.customer || "").replaceAll(",", " "),
        CustomerEmail: (b.customerEmail || "").replaceAll(",", " "),
        CustomerPhone: (b.customerPhone || "").replaceAll(",", " "),
        Routes: Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} to ${i.travelTo || "—"}`))).join(" | ").replaceAll(",", " "),
        Vehicles: String(items.length),
        CarLines: items.map((i) => `${i.carName} (${i.carNumber}) ${i.travelFrom || "—"}->${i.travelTo || "—"} [${normalizeSelectedDates(i.selectedDates).map(toISODateString).join(";")}]`).join(" | ").replaceAll(",", " "),
        Sources: Array.from(new Set(items.map((i) => i.sourceName).filter(Boolean))).join(" | ").replaceAll(",", " "),
        Status: b.status || "",
        Days: String(computeBookingDateSummary(items).length),
        Dates: computeBookingDateSummary(items).map(toISODateString).join(" | "),
        ClientGross: String(totals.totalGrossClientAmount || 0),
        Discount: String(totals.totalDiscountAmount || 0),
        ClientNet: String(totals.totalNetClientAmount || 0),
        SupplierPayable: String(totals.totalNetSupplierPayable || 0),
        AdminIncome: String(totals.totalNetAdminIncome || 0),
        AmountPaid: String(amountPaid || 0),
        Balance: String(balance || 0),
        PaymentStatus: String(payStatus || "unpaid"),
      };
    });
    const header = Object.keys(rows[0]).join(",");
    const body = rows.map((r) => Object.values(r).join(",")).join("\n");
    const csvContent = "data:text/csv;charset=utf-8," + header + "\n" + body;
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `bookings_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const closeDocumentPanels = () => {
    setQuotationOpen(false);
    setInvoiceOpen(false);
    setReceiptOpen(false);
    setSupplierStatementOpen(false);
    setSupplierRequestOpen(false);
    setSupplierResponseOpen(false);
    setSupplierVoucherOpen(false);
  };
  const openQuotation = (b) => { closeDocumentPanels(); setQuotationBooking(b); setQuotationNumber(generateDocNumber("QUO")); setQuotationNotes(companyProfile.quotationTerms || ""); setActiveView("documents"); setQuotationOpen(true); };
  const openInvoice = (b) => { closeDocumentPanels(); setInvoiceBooking(b); setInvoiceNumber(generateDocNumber("INV")); setInvoiceNotes(companyProfile.invoiceFooter || ""); setActiveView("documents"); setInvoiceOpen(true); };
  const openReceipt = (b) => { closeDocumentPanels(); setReceiptBooking(b); setReceiptNumber(generateDocNumber("RCT")); setReceiptNotes(companyProfile.receiptFooter || "Payment received with thanks."); setActiveView("documents"); setReceiptOpen(true); };
  const openSupplierStatement = (b, sourceId = "") => {
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    closeDocumentPanels();
    setSupplierStatementBooking(b);
    setSupplierStatementSourceId(firstSource);
    setSupplierStatementNumber(generateDocNumber("SUP"));
    setActiveView("documents");
    setSupplierStatementOpen(true);
  };
  const openSupplierRequest = (b, sourceId = "") => {
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    closeDocumentPanels();
    setSupplierRequestBooking(b);
    setSupplierRequestSourceId(firstSource);
    setSupplierRequestNumber(generateDocNumber("REQ"));
    setSupplierRequestNotes("Kindly confirm vehicle availability, vehicle registration, driver name, driver contact and confirmed supplier rate for the requested trip.");
    setActiveView("documents");
    setSupplierRequestOpen(true);
  };
  const openSupplierResponse = (b, sourceId = "") => {
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    const sourceItems = firstSource ? items.filter((i) => i.sourceId === firstSource) : items;
    closeDocumentPanels();
    setSupplierResponseBooking(b);
    setSupplierResponseSourceId(firstSource);
    setSupplierResponseNumber(generateDocNumber("RESP"));
    setSupplierResponseNotes("");
    setSupplierResponseLines(sourceItems.map((i) => ({
      itemId: i.itemId,
      requestedCarName: i.carName || "",
      requestedCarNumber: i.carNumber || "",
      confirmedCarName: i.confirmedCarName || i.supplierConfirmedCarName || "",
      confirmedCarNumber: i.confirmedCarNumber || i.supplierConfirmedCarNumber || "",
      confirmedDriverName: i.confirmedDriverName || i.supplierConfirmedDriverName || i.driver || "",
      confirmedDriverPhone: i.confirmedDriverPhone || i.supplierConfirmedDriverPhone || i.driverPhone || "",
      confirmedSupplierRate: i.confirmedSupplierRate || i.supplierConfirmedRate || i.supplierRate || "",
      responseStatus: i.supplierResponseStatus || "confirmed",
      supplierNotes: i.supplierResponseNotes || "",
    })));
    setActiveView("documents");
    setSupplierResponseOpen(true);
  };

  const openSupplierVoucher = (b, sourceId = "") => {
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    closeDocumentPanels();
    setSupplierVoucherBooking(b);
    setSupplierVoucherSourceId(firstSource);
    setSupplierVoucherNumber(generateDocNumber("SUP-VCH"));
    setSupplierVoucherNotes("Supplier settlement voucher prepared after review of confirmed vehicle line(s), discount sharing and recorded supplier payments.");
    setActiveView("documents");
    setSupplierVoucherOpen(true);
  };
  const saveQuotationToAudit = async () => {
    if (!quotationBooking) return;
    const totals = getBookingTotals(quotationBooking, cars);
    const vat = getBookingVatSummary(quotationBooking, cars);
    await addDoc(collection(db, "audit"), { action: `Quotation generated (${quotationNumber}) for ${quotationBooking.customer} — Vehicles ${getBookingItems(quotationBooking, cars).length} — Total ${currencyGH(vat.grandTotal)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), quotationNumber, bookingId: quotationBooking.id, documentType: "quotation", vatSummary: vat });
    await sendEmailNotification({ toEmail: quotationBooking.customerEmail, bookingId: quotationBooking.id, actionType: "quotation_generated", subject: `Quotation ${quotationNumber} - ${quotationBooking.customer || "Customer"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nQUOTATION\nQuotation No: ${quotationNumber}\nCustomer: ${quotationBooking.customer || ""}\nVehicles: ${getBookingItems(quotationBooking, cars).length}\nRoutes: ${Array.from(new Set(getBookingItems(quotationBooking, cars).map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}\nDates: ${computeBookingDateSummary(getBookingItems(quotationBooking, cars)).map(toISODateString).join(", ")}\nSubtotal: ${currencyGH(vat.subtotal)}\nDiscount: ${currencyGH(vat.discount)}\nTaxable Amount: ${currencyGH(vat.taxableAmount)}\nVAT @ 15%: ${currencyGH(vat.vat)}\nNHIL @ 2.5%: ${currencyGH(vat.nhil)}\nGETFund @ 2.5%: ${currencyGH(vat.getfund)}\nGrand Total: ${currencyGH(vat.grandTotal)}\n\n${quotationNotes || companyProfile.quotationTerms || ""}` });
    setQuotationOpen(false);
  };
  const saveInvoiceToAudit = async () => {
    if (!invoiceBooking) return;
    const totals = getBookingTotals(invoiceBooking, cars);
    const vat = getBookingVatSummary(invoiceBooking, cars);
    await addDoc(collection(db, "audit"), { action: `Invoice generated (${invoiceNumber}) for ${invoiceBooking.customer} — Vehicles ${getBookingItems(invoiceBooking, cars).length} — Total ${currencyGH(vat.grandTotal)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), invoiceNumber, bookingId: invoiceBooking.id, documentType: "invoice", vatSummary: vat });
    await sendEmailNotification({ toEmail: invoiceBooking.customerEmail, bookingId: invoiceBooking.id, actionType: "invoice_generated", subject: `Invoice ${invoiceNumber} - ${invoiceBooking.customer || "Customer"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nINVOICE\nInvoice No: ${invoiceNumber}\nCustomer: ${invoiceBooking.customer || ""}\nVehicles: ${getBookingItems(invoiceBooking, cars).length}\nSubtotal: ${currencyGH(vat.subtotal)}\nDiscount: ${currencyGH(vat.discount)}\nVAT @ 15%: ${currencyGH(vat.vat)}\nNHIL @ 2.5%: ${currencyGH(vat.nhil)}\nGETFund @ 2.5%: ${currencyGH(vat.getfund)}\nGrand Total: ${currencyGH(vat.grandTotal)}\n\n${invoiceNotes || companyProfile.invoiceFooter || ""}` });
    setInvoiceOpen(false);
  };
  const saveReceiptToAudit = async () => {
    if (!receiptBooking) return;
    const totals = getBookingTotals(receiptBooking, cars);
    const vat = getBookingVatSummary(receiptBooking, cars);
    const paid = clampMoney(receiptBooking.amountPaid || 0);
    const balance = Math.max(0, vat.grandTotal - paid);
    await addDoc(collection(db, "audit"), { action: `Receipt generated (${receiptNumber}) for ${receiptBooking.customer} — Paid ${currencyGH(paid)} — Balance ${currencyGH(balance)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), receiptNumber, bookingId: receiptBooking.id, documentType: "receipt", vatSummary: vat, amountPaid: paid, balance });
    await sendEmailNotification({ toEmail: receiptBooking.customerEmail, bookingId: receiptBooking.id, actionType: "receipt_generated", subject: `Receipt ${receiptNumber} - ${receiptBooking.customer || "Customer"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nRECEIPT\nReceipt No: ${receiptNumber}\nCustomer: ${receiptBooking.customer || ""}\nVehicles: ${getBookingItems(receiptBooking, cars).length}\nAmount Received to Date: ${currencyGH(paid)}\nOutstanding Balance: ${currencyGH(balance)}\n\n${receiptNotes || companyProfile.receiptFooter || ""}` });
    setReceiptOpen(false);
  };
  const saveSupplierRequestToAudit = async () => {
    if (!supplierRequestBooking || !supplierRequestSourceId) return;
    const source = sources.find((s) => s.id === supplierRequestSourceId);
    const items = getBookingItems(supplierRequestBooking, cars).filter((i) => i.sourceId === supplierRequestSourceId);
    const dates = computeBookingDateSummary(items).map(toISODateString).join(", ");
    await addDoc(collection(db, "audit"), { action: `Supplier request generated (${supplierRequestNumber}) for ${source?.sourceName || "Supplier"} — Vehicles ${items.length}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), supplierRequestNumber, bookingId: supplierRequestBooking.id, sourceId: supplierRequestSourceId, documentType: "supplier_request" });
    await sendEmailNotification({ toEmail: source?.email || "", bookingId: supplierRequestBooking.id, actionType: "supplier_request_generated", subject: `Vehicle Request ${supplierRequestNumber} - ${companyProfile.companyName || "MAALVILA"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nSUPPLIER VEHICLE REQUEST\nRequest No: ${supplierRequestNumber}\nSupplier: ${source?.sourceName || ""}\nClient: ${supplierRequestBooking.customer || ""}\nNumber of vehicles requested: ${items.length}\nDates: ${dates}\nRoutes: ${Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}\n\nPlease respond with vehicle model, registration number, driver name, driver contact, confirmed rate and any operational notes.\n\n${supplierRequestNotes || ""}` });
    alert("Supplier request saved to Audit Trail and email attempted if supplier email exists.");
    setSupplierRequestOpen(false);
  };
  const updateSupplierResponseLine = (itemId, patch) => {
    setSupplierResponseLines((lines) => lines.map((line) => line.itemId === itemId ? { ...line, ...patch } : line));
  };
  const saveSupplierResponseToAudit = async () => {
    if (!supplierResponseBooking || !supplierResponseSourceId) return;
    const source = sources.find((s) => s.id === supplierResponseSourceId);
    const existingItems = getBookingItems(supplierResponseBooking, cars);
    const responseByItemId = new Map(supplierResponseLines.map((line) => [line.itemId, line]));
    const updatedItems = existingItems.map((item) => {
      const response = responseByItemId.get(item.itemId);
      if (!response) return item;
      return {
        ...item,
        supplierResponseStatus: response.responseStatus || "confirmed",
        confirmedCarName: response.confirmedCarName || "",
        confirmedCarNumber: response.confirmedCarNumber || "",
        confirmedDriverName: response.confirmedDriverName || "",
        confirmedDriverPhone: response.confirmedDriverPhone || "",
        confirmedSupplierRate: Number(response.confirmedSupplierRate || item.supplierRate || 0),
        supplierResponseNotes: response.supplierNotes || "",
        supplierResponseNumber,
        supplierResponseUpdatedAtText: new Date().toISOString(),
      };
    });
    await updateDoc(doc(db, "bookings", supplierResponseBooking.id), {
      bookingItems: updatedItems,
      supplierResponseUpdatedAt: serverTimestamp(),
      supplierResponseUpdatedBy: user?.email || roleEmail || "",
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "audit"), {
      action: `Supplier response captured (${supplierResponseNumber}) for ${source?.sourceName || "Supplier"} — Vehicles ${supplierResponseLines.length}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
      supplierResponseNumber,
      bookingId: supplierResponseBooking.id,
      sourceId: supplierResponseSourceId,
      documentType: "supplier_response",
      responseLines: supplierResponseLines,
    });
    alert("Supplier response saved to booking and Audit Trail.");
    setSupplierResponseOpen(false);
  };
  const saveSupplierStatementToAudit = async () => {
    if (!supplierStatementBooking || !supplierStatementSourceId) return;
    const source = sources.find((s) => s.id === supplierStatementSourceId);
    const items = getBookingItems(supplierStatementBooking, cars).filter((i) => i.sourceId === supplierStatementSourceId);
    const totals = computePricingTotals(items);
    await addDoc(collection(db, "audit"), { action: `Supplier statement generated (${supplierStatementNumber}) for ${source?.sourceName || "Supplier"} — Net payable ${currencyGH(totals.totalNetSupplierPayable)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), supplierStatementNumber, bookingId: supplierStatementBooking.id, sourceId: supplierStatementSourceId, documentType: "supplier_statement", supplierTotals: totals });
    alert("Supplier statement saved to Audit Trail.");
  };

  const saveSupplierVoucherToAudit = async () => {
    if (!supplierVoucherBooking || !supplierVoucherSourceId) return;
    const source = sources.find((s) => s.id === supplierVoucherSourceId);
    const items = getBookingItems(supplierVoucherBooking, cars).filter((i) => i.sourceId === supplierVoucherSourceId);
    const totals = computePricingTotals(items);
    const sourcePayments = supplierPaymentHistory.filter((p) => String(p.sourceId || "") === String(supplierVoucherSourceId)).reduce((sum, p) => sum + clampMoney(p.amount), 0);
    const balance = Math.max(0, totals.totalNetSupplierPayable - sourcePayments);
    await addDoc(collection(db, "audit"), { action: `Supplier settlement voucher generated (${supplierVoucherNumber}) for ${source?.sourceName || "Supplier"} — Balance ${currencyGH(balance)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), supplierVoucherNumber, bookingId: supplierVoucherBooking.id, sourceId: supplierVoucherSourceId, documentType: "supplier_settlement_voucher", supplierTotals: totals, supplierPaidToDate: sourcePayments, supplierBalance: balance });
    alert("Supplier settlement voucher saved to Audit Trail.");
  };

  const openPayment = (b) => { if (!can(role, "recordPayment")) return alert("Only Admin/Staff can record payments."); setPaymentBooking(b); setPaymentAmount(""); setPaymentMethod("cash"); setPaymentReference(""); setPaymentNote(""); setPaymentOpen(true); };

  const openSupplierPayment = (b, sourceId = "") => {
    if (!can(role, "recordSupplierPayment")) return alert("Only Admin/Staff can record supplier payments.");
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    setSupplierPaymentBooking(b);
    setSupplierPaymentSourceId(firstSource);
    setSupplierPaymentAmount("");
    setSupplierPaymentMethod("cash");
    setSupplierPaymentReference("");
    setSupplierPaymentNote("");
    setSupplierPaymentOpen(true);
  };

  const recordSupplierPayment = async () => {
    if (!supplierPaymentBooking?.id) return;
    if (!supplierPaymentSourceId) return alert("Select supplier/source before saving supplier payment.");
    const amt = clampMoney(supplierPaymentAmount);
    if (!amt) return alert("Enter a valid supplier payment amount.");
    const source = sources.find((s) => s.id === supplierPaymentSourceId);
    await addDoc(collection(db, "bookings", supplierPaymentBooking.id, "supplierPayments"), { sourceId: supplierPaymentSourceId, sourceName: source?.sourceName || "", amount: amt, method: supplierPaymentMethod || "cash", reference: (supplierPaymentReference || "").trim(), note: (supplierPaymentNote || "").trim(), paidAt: serverTimestamp(), recordedByEmail: user?.email || roleEmail || "", recordedByUid: user?.uid || "" });
    await updateDoc(doc(db, "bookings", supplierPaymentBooking.id), { supplierPaidTotal: increment(amt), supplierPaymentUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await addDoc(collection(db, "audit"), { action: `Supplier payment recorded for ${source?.sourceName || "Supplier"} — ${currencyGH(amt)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), bookingId: supplierPaymentBooking.id, sourceId: supplierPaymentSourceId, supplierPaymentAmount: amt, supplierPaymentMethod: supplierPaymentMethod || "cash", documentType: "supplier_payment" });
    setSupplierPaymentOpen(false);
  };
  const recordPayment = async () => {
    if (!paymentBooking?.id) return;
    const amt = clampMoney(paymentAmount);
    if (!amt) return alert("Enter a valid payment amount.");
    const total = computeBookingTotalAmount(paymentBooking, cars);
    const newPaid = clampMoney(Number(paymentBooking.amountPaid || 0) + amt);
    const newStatus = computePaymentStatus(total, newPaid);
    await addDoc(collection(db, "bookings", paymentBooking.id, "payments"), { amount: amt, method: paymentMethod || "cash", reference: (paymentReference || "").trim(), note: (paymentNote || "").trim(), paidAt: serverTimestamp(), recordedByEmail: user?.email || roleEmail || "", recordedByUid: user?.uid || "" });
    await updateDoc(doc(db, "bookings", paymentBooking.id), { amountPaid: increment(amt), paymentStatus: newStatus, paymentUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await addDoc(collection(db, "audit"), { action: `Payment recorded for ${paymentBooking.customer} — ${currencyGH(amt)} — Status: ${newStatus}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), bookingId: paymentBooking.id, paymentAmount: amt, paymentMethod: paymentMethod || "cash" });
    setPaymentOpen(false);
  };

  if (!user) return <div className="p-10 text-center text-xl">Login first to load dashboard</div>;
  if (loadingRole) return <div className="p-10 text-center text-lg">Loading role...</div>;

  const kpiCards = [
    { label: "Bookings", value: bookings.length, icon: <ClipboardList className="w-5 h-5" />, bg: "bg-blue-50 border-blue-100" },
    { label: "Vehicle Lines", value: bookedVehicleLines, icon: <Car className="w-5 h-5" />, bg: "bg-amber-50 border-amber-100" },
    { label: "Cars", value: carsKPI, icon: <Car className="w-5 h-5" />, bg: "bg-orange-50 border-orange-100" },
    { label: "Sources", value: sources.length, icon: <UsersRound className="w-5 h-5" />, bg: "bg-indigo-50 border-indigo-100" },
    { label: "Client Net Revenue", value: currencyGH(confirmedTotals.client), icon: <Banknote className="w-5 h-5" />, bg: "bg-emerald-50 border-emerald-100" },
    { label: "Supplier Payable", value: currencyGH(confirmedTotals.supplier), icon: <Banknote className="w-5 h-5" />, bg: "bg-rose-50 border-rose-100" },
    { label: "MAALVILA Admin Income", value: currencyGH(confirmedTotals.admin), icon: <Banknote className="w-5 h-5" />, bg: "bg-sky-50 border-sky-100" },
    { label: "Discounts Given", value: currencyGH(confirmedTotals.discount), icon: <Banknote className="w-5 h-5" />, bg: "bg-yellow-50 border-yellow-100" },
    { label: "Outstanding Balance", value: currencyGH(outstandingTotal), icon: <Banknote className="w-5 h-5" />, bg: "bg-violet-50 border-violet-100" },
    { label: "Paid Last 30 Days", value: currencyGH(paidLast30Days), icon: <Banknote className="w-5 h-5" />, bg: "bg-teal-50 border-teal-100" },
    { label: "Penalties", value: currencyGH(penaltyTotal), icon: <Banknote className="w-5 h-5" />, bg: "bg-red-50 border-red-100" },
  ];

  const renderBrandHeader = () => <>
    {companyProfile.letterheadUrl ? <img src={companyProfile.letterheadUrl} alt="Letterhead" className="w-full max-h-32 object-contain border rounded-xl bg-white mb-3" /> : companyProfile.logoUrl ? <img src={companyProfile.logoUrl} alt="Logo" className="h-20 object-contain mb-3" /> : null}
    <div className="text-center mb-3"><div className="text-xl font-bold">{companyProfile.companyName || "MAALVILA Car Rental Services"}</div><div className="text-xs text-gray-600">{companyProfile.companyAddress || ""}</div><div className="text-xs text-gray-600">{companyProfile.companyPhone || ""} {companyProfile.companyEmail ? `• ${companyProfile.companyEmail}` : ""}</div><div className="text-xs text-gray-600">{companyProfile.companyTin ? `TIN: ${companyProfile.companyTin}` : ""}{companyProfile.vatNumber ? ` • VAT No: ${companyProfile.vatNumber}` : ""}</div></div>
  </>;

  const ClientDocumentPreview = ({ type, number, booking, notes = "" }) => {
    const items = getBookingItems(booking, cars);
    const totals = getBookingTotals(booking, cars);
    const vat = getBookingVatSummary(booking, cars);
    return <div className="border rounded-xl p-4 bg-white space-y-3">{renderBrandHeader()}<div className="border-t pt-3"><div className="text-sm text-gray-600">{type}</div><div className="text-lg font-bold">{number}</div></div><div className="grid md:grid-cols-2 gap-2 text-sm"><div>Customer: <b>{booking.customer}</b></div><div>Email: <b>{booking.customerEmail || "—"}</b></div><div className="md:col-span-2">Routes Summary: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="md:col-span-2">Booking Dates Summary: <b>{computeBookingDateSummary(items).map(toISODateString).join(", ")}</b></div></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Car No.</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2 text-right">Days</th><th className="p-2 text-right">Daily Rate</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Discount</th><th className="p-2">VAT Treatment</th><th className="p-2 text-right">Tax</th><th className="p-2 text-right">Grand Total</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2">{i.carName}</td><td className="p-2">{i.carNumber}</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2 text-right">{i.days}</td><td className="p-2 text-right">{currencyGH(i.clientDailyRate)}</td><td className="p-2 text-right">{currencyGH(i.grossClientAmount)}</td><td className="p-2 text-right">{currencyGH(i.discountAmount)}</td><td className="p-2">{clientVatModeLabel(i.clientVatMode)}</td><td className="p-2 text-right">{currencyGH(i.taxAmount)}</td><td className="p-2 text-right font-medium">{currencyGH(i.clientGrandTotal)}</td></tr>)}</tbody></table></div><div className="border-t pt-3 text-sm space-y-1">{[["Subtotal", vat.subtotal], ["Discount", vat.discount], ["Taxable Amount", vat.taxableAmount], ["VAT @ 15%", vat.vat], ["NHIL @ 2.5%", vat.nhil], ["GETFund @ 2.5%", vat.getfund]].map(([label, val]) => <div key={label} className="flex justify-between"><span>{label}</span><b>{currencyGH(val)}</b></div>)}<div className="flex justify-between border-t pt-2 text-base"><span>Grand Total</span><b>{currencyGH(vat.grandTotal)}</b></div><div className="flex justify-between text-xs text-gray-600"><span>VAT Treatment</span><b>{vat.vatModesText || "Mixed per vehicle line"}</b></div></div>{notes ? <div className="text-xs text-gray-600 border-t pt-2">{notes}</div> : null}</div>;
  };
  const SupplierRequestPreview = ({ booking, sourceId, number, notes = "" }) => {
    const source = sources.find((s) => s.id === sourceId);
    const items = getBookingItems(booking, cars).filter((i) => i.sourceId === sourceId);
    return <div className="border rounded-xl p-4 bg-white space-y-3">{renderBrandHeader()}<div className="border-t pt-3"><div className="text-sm text-gray-600">Supplier Vehicle Request</div><div className="text-lg font-bold">{number}</div></div><div className="grid md:grid-cols-2 gap-2 text-sm"><div>Supplier: <b>{source?.sourceName || "—"}</b></div><div>Email: <b>{source?.email || "—"}</b></div><div>Client: <b>{booking.customer}</b></div><div>Vehicles Requested: <b>{items.length}</b></div><div className="md:col-span-2">Routes: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="md:col-span-2">Dates: <b>{computeBookingDateSummary(items).map(toISODateString).join(", ")}</b></div></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Requested Car</th><th className="p-2">Route</th><th className="p-2">Dates</th><th className="p-2 text-right">Days</th><th className="p-2 text-right">Proposed Supplier Rate</th><th className="p-2">Supplier Response Required</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2">{i.carName} ({i.carNumber})</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2 text-right">{i.days}</td><td className="p-2 text-right">{currencyGH(i.supplierRate)}</td><td className="p-2">Vehicle model, registration number, driver name, driver contact, confirmed rate, notes</td></tr>)}</tbody></table></div><div className="text-sm border-t pt-2">{notes || "Kindly confirm availability and operational details for the requested vehicle(s)."}</div></div>;
  };
  const SupplierVoucherPreview = ({ booking, sourceId, number, notes = "" }) => {
    const source = sources.find((s) => s.id === sourceId);
    const items = getBookingItems(booking, cars).filter((i) => i.sourceId === sourceId);
    const totals = computePricingTotals(items);
    const paidToDate = supplierPaymentHistory.filter((p) => String(p.sourceId || "") === String(sourceId)).reduce((sum, p) => sum + clampMoney(p.amount), 0);
    const balance = Math.max(0, totals.totalNetSupplierPayable - paidToDate);

    const splitSupplierTaxComponent = (amountValue, vatModeValue) => {
      const amount = clampMoney(amountValue);
      const mode = normalizeClientVatMode(vatModeValue || "exclusive");
      const totalRate = GHANA_VAT_RATE + GHANA_NHIL_RATE + GHANA_GETFUND_RATE;

      if (!clientVatApplies(mode)) {
        return { amount, base: amount, vat: 0, nhil: 0, getfund: 0, totalTax: 0, totalWithTax: amount, mode };
      }

      if (mode === "inclusive") {
        const base = amount / (1 + totalRate);
        const vat = base * GHANA_VAT_RATE;
        const nhil = base * GHANA_NHIL_RATE;
        const getfund = base * GHANA_GETFUND_RATE;
        return { amount, base, vat, nhil, getfund, totalTax: vat + nhil + getfund, totalWithTax: amount, mode };
      }

      const base = amount;
      const vat = base * GHANA_VAT_RATE;
      const nhil = base * GHANA_NHIL_RATE;
      const getfund = base * GHANA_GETFUND_RATE;
      return { amount, base, vat, nhil, getfund, totalTax: vat + nhil + getfund, totalWithTax: base + vat + nhil + getfund, mode };
    };

    const voucherTaxRows = items.map((i) => {
      const supplierSplit = splitSupplierTaxComponent(i.netSupplierPayable, i.clientVatMode);
      return { item: i, supplierSplit };
    });

    const voucherTaxTotals = voucherTaxRows.reduce((t, row) => {
      t.supplierAmount += row.supplierSplit.amount;
      t.supplierBase += row.supplierSplit.base;
      t.supplierVat += row.supplierSplit.vat;
      t.supplierNhil += row.supplierSplit.nhil;
      t.supplierGetfund += row.supplierSplit.getfund;
      t.supplierTax += row.supplierSplit.totalTax;
      return t;
    }, {
      supplierAmount: 0,
      supplierBase: 0,
      supplierVat: 0,
      supplierNhil: 0,
      supplierGetfund: 0,
      supplierTax: 0
    });

    const voucherVatModes = Array.from(new Set(items.map((i) => clientVatModeLabel(i.clientVatMode || "exclusive")))).join(" | ") || "—";

    return <div className="border rounded-xl p-4 bg-white space-y-3">
      {renderBrandHeader()}

      <div className="border-t pt-3">
        <div className="text-sm text-gray-600">Supplier Settlement Voucher</div>
        <div className="text-lg font-bold">{number}</div>
      </div>

      <div className="grid md:grid-cols-2 gap-2 text-sm">
        <div>Supplier: <b>{source?.sourceName || "—"}</b></div>
        <div>Email: <b>{source?.email || "—"}</b></div>
        <div>Client: <b>{booking.customer}</b></div>
        <div>Vehicle Lines: <b>{items.length}</b></div>
        <div className="md:col-span-2">VAT Treatment: <b>{voucherVatModes}</b></div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs border">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="p-2">Vehicle</th>
              <th className="p-2">Route</th>
              <th className="p-2">Dates</th>
              <th className="p-2 text-right">Supplier Gross / Inclusive</th>
              <th className="p-2 text-right">Supplier Tax Base</th>
              <th className="p-2 text-right">Supplier Tax</th>
              <th className="p-2 text-right">Net Supplier Payable</th>
            </tr>
          </thead>
          <tbody>
            {voucherTaxRows.map(({ item: i, supplierSplit }) => (
              <tr key={i.itemId} className="border-t">
                <td className="p-2">{i.carName} ({i.carNumber})</td>
                <td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td>
                <td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td>
                <td className="p-2 text-right">{currencyGH(supplierSplit.amount)}</td>
                <td className="p-2 text-right">{currencyGH(supplierSplit.base)}</td>
                <td className="p-2 text-right">{currencyGH(supplierSplit.totalTax)}</td>
                <td className="p-2 text-right font-medium">{currencyGH(i.netSupplierPayable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t pt-3 text-sm space-y-1">
        <div className="flex justify-between"><span>Total Supplier Gross / Inclusive</span><b>{currencyGH(totals.totalNetSupplierPayable)}</b></div>
        <div className="flex justify-between"><span>Supplier Tax-Exclusive Base</span><b>{currencyGH(voucherTaxTotals.supplierBase)}</b></div>
        <div className="flex justify-between"><span>Supplier Tax Included / Added</span><b>{currencyGH(voucherTaxTotals.supplierTax)}</b></div>
        <div className="flex justify-between"><span>Supplier Paid to Date</span><b>{currencyGH(paidToDate)}</b></div>
        <div className="flex justify-between border-t pt-2 text-base"><span>Supplier Balance Payable</span><b>{currencyGH(balance)}</b></div>
      </div>

      <div className="border rounded-xl bg-slate-50 p-3 text-sm space-y-3">
        <div>
          <div className="font-semibold">Supplier VAT Split Transparency</div>
          <div className="text-xs text-gray-600">This supplier-facing voucher shows only the selected supplier portion. MAALVILA admin charges and combined client totals are excluded from this voucher.</div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-xs border bg-white">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="p-2">Component</th>
                <th className="p-2 text-right">Gross / Inclusive Amount</th>
                <th className="p-2 text-right">Tax-Exclusive Base</th>
                <th className="p-2 text-right">VAT 15%</th>
                <th className="p-2 text-right">NHIL 2.5%</th>
                <th className="p-2 text-right">GETFund 2.5%</th>
                <th className="p-2 text-right">Total Tax</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2 font-medium">Selected Supplier Portion</td>
                <td className="p-2 text-right">{currencyGH(voucherTaxTotals.supplierAmount)}</td>
                <td className="p-2 text-right">{currencyGH(voucherTaxTotals.supplierBase)}</td>
                <td className="p-2 text-right">{currencyGH(voucherTaxTotals.supplierVat)}</td>
                <td className="p-2 text-right">{currencyGH(voucherTaxTotals.supplierNhil)}</td>
                <td className="p-2 text-right">{currencyGH(voucherTaxTotals.supplierGetfund)}</td>
                <td className="p-2 text-right font-medium">{currencyGH(voucherTaxTotals.supplierTax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {notes ? <div className="text-sm border-t pt-2">{notes}</div> : null}
    </div>;
  };
  const SupplierStatementPreview = ({ booking, sourceId, number }) => {
    const source = sources.find((s) => s.id === sourceId);
    const items = getBookingItems(booking, cars).filter((i) => i.sourceId === sourceId);
    const totals = computePricingTotals(items);
    return <div className="border rounded-xl p-4 bg-white space-y-3">{renderBrandHeader()}<div className="border-t pt-3"><div className="text-sm text-gray-600">Supplier Statement</div><div className="text-lg font-bold">{number}</div></div><div className="grid md:grid-cols-2 gap-2 text-sm"><div>Supplier: <b>{source?.sourceName || "—"}</b></div><div>Type: <b>{sourceTypeLabel(source?.sourceType)}</b></div><div>Client: <b>{booking.customer}</b></div><div>Routes: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="md:col-span-2">Booking Dates Summary: <b>{computeBookingDateSummary(items).map(toISODateString).join(", ")}</b></div></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Car No.</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2 text-right">Days</th><th className="p-2 text-right">Supplier Rate</th><th className="p-2 text-right">Gross Supplier</th><th className="p-2 text-right">Discount Share</th><th className="p-2 text-right">Net Payable</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2">{i.carName}</td><td className="p-2">{i.carNumber}</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2 text-right">{i.days}</td><td className="p-2 text-right">{currencyGH(i.supplierRate)}</td><td className="p-2 text-right">{currencyGH(i.grossSupplierAmount)}</td><td className="p-2 text-right">{currencyGH(i.supplierDiscountShare)}</td><td className="p-2 text-right font-medium">{currencyGH(i.netSupplierPayable)}</td></tr>)}</tbody></table></div><div className="border-t pt-3 text-sm space-y-1"><div className="flex justify-between"><span>Gross Supplier Amount</span><b>{currencyGH(totals.totalGrossSupplierAmount)}</b></div><div className="flex justify-between"><span>Supplier Discount Share</span><b>{currencyGH(totals.totalSupplierDiscountShare)}</b></div><div className="flex justify-between border-t pt-2 text-base"><span>Net Supplier Payable</span><b>{currencyGH(totals.totalNetSupplierPayable)}</b></div></div><div className="border rounded-xl bg-slate-50 p-3 text-sm space-y-3"><div><div className="font-semibold">VAT Split Transparency</div><div className="text-xs text-gray-600">This is a transparency control only. Supplier net payable is not changed. VAT is allocated between the supplier portion and MAALVILA admin charge based on the net line split.</div></div><div className="overflow-auto"><table className="w-full text-xs border bg-white"><thead><tr className="bg-slate-100 text-left"><th className="p-2">Component</th><th className="p-2 text-right">Base / Net Amount</th><th className="p-2 text-right">VAT 15%</th><th className="p-2 text-right">NHIL 2.5%</th><th className="p-2 text-right">GETFund 2.5%</th><th className="p-2 text-right">Total Tax</th></tr></thead><tbody><tr className="border-t"><td className="p-2 font-medium">Selected Supplier Portion</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.supplierBase)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.supplierVat)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.supplierNhil)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.supplierGetfund)}</td><td className="p-2 text-right font-medium">{currencyGH(voucherVatSplitTotals.supplierTotalTax)}</td></tr><tr className="border-t"><td className="p-2 font-medium">MAALVILA Admin Charge Portion</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.adminBase)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.adminVat)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.adminNhil)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.adminGetfund)}</td><td className="p-2 text-right font-medium">{currencyGH(voucherVatSplitTotals.adminTotalTax)}</td></tr><tr className="border-t bg-slate-50"><td className="p-2 font-semibold">Client Tax Total for Selected Voucher Lines</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.supplierBase + voucherVatSplitTotals.adminBase)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.totalVat)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.totalNhil)}</td><td className="p-2 text-right">{currencyGH(voucherVatSplitTotals.totalGetfund)}</td><td className="p-2 text-right font-semibold">{currencyGH(voucherVatSplitTotals.totalTax)}</td></tr></tbody></table></div></div></div>;
  };

  return <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto bg-slate-50 min-h-screen">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold">Rental Dashboard - Phase 3R-C Supplier Voucher Privacy Cleanup</motion.h1><div className="flex items-center gap-2"><div className="text-sm text-gray-700">Signed in: <b>{roleEmail || user.email || "unknown"}</b> • Role: <b className="uppercase">{role}</b></div><Button variant="outline" className="gap-2" onClick={logout}><LogOut className="w-4 h-4" /> Logout</Button></div></div>
    <Card className="rounded-2xl border bg-white"><CardContent className="p-3"><div className="flex flex-wrap gap-2">{[{ key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> }, { key: "bookings", label: "Bookings", icon: <ClipboardList className="w-4 h-4" /> }, { key: "availability", label: "Availability", icon: <CalendarDays className="w-4 h-4" /> }, { key: "dispatch", label: "Dispatch", icon: <ClipboardList className="w-4 h-4" /> }, { key: "closeout", label: "Trip Closeout", icon: <Car className="w-4 h-4" /> }, { key: "maintenance", label: "Maintenance", icon: <Car className="w-4 h-4" /> }, { key: "reports", label: "Reports", icon: <FileText className="w-4 h-4" /> }, { key: "profitability", label: "Profitability", icon: <Banknote className="w-4 h-4" /> }, { key: "fuelClaims", label: "Fuel Claims", icon: <ReceiptText className="w-4 h-4" /> }, { key: "launch", label: "Launch Readiness", icon: <ReceiptText className="w-4 h-4" /> }, { key: "customers", label: "Customers", icon: <UsersRound className="w-4 h-4" /> }, { key: "suppliers", label: "Suppliers", icon: <Building2 className="w-4 h-4" /> }, { key: "cars", label: "Cars & Sources", icon: <Car className="w-4 h-4" /> }, { key: "documents", label: "Documents", icon: <ReceiptText className="w-4 h-4" /> }, { key: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> }, { key: "audit", label: "Audit Trail", icon: <FileText className="w-4 h-4" /> }].map((tab) => <Button key={tab.key} variant={activeView === tab.key ? "default" : "outline"} className="gap-2" onClick={() => setActiveView(tab.key)}>{tab.icon}{tab.label}</Button>)}</div></CardContent></Card>

    {activeView === "overview" && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{kpiCards.map((k) => <Card key={k.label} className={`rounded-2xl border ${k.bg}`}><CardContent className="p-4 flex items-center gap-3"><div className="p-2 rounded-xl bg-white/80">{k.icon}</div><div><div className="text-xs text-gray-600">{k.label}</div><div className="text-xl font-bold">{k.value}</div></div></CardContent></Card>)}</div><div className="grid lg:grid-cols-2 gap-4"><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Top Cars (Vehicle Lines)</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={topCarsBarData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" hide /><YAxis /><ReTooltip formatter={(v) => [`${v}`, "Vehicle lines"]} /><Bar dataKey="count">{topCarsBarData.map((r) => <Cell key={r.carNo} fill={hashColor(r.carNo)} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Booking Status</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><PieChart><ReTooltip /><Legend /><Pie data={statusPieData} dataKey="value" nameKey="name" outerRadius={90} label>{statusPieData.map((s) => <Cell key={s.name} fill={hashColor(s.name)} />)}</Pie></PieChart></ResponsiveContainer></div></CardContent></Card></div><div className="grid lg:grid-cols-2 gap-4"><Card className="rounded-2xl"><CardContent className="p-4"><div className="flex justify-between gap-2"><h2 className="font-semibold text-lg">Client Net Revenue Trend</h2><select className="border rounded-lg p-2 text-sm" value={trendMode} onChange={(e) => setTrendMode(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><LineChart data={revenueTrendData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><ReTooltip formatter={(v) => [currencyGH(v), "Revenue"]} /><Line type="monotone" dataKey="revenue" stroke={hashColor("revenue")} strokeWidth={3} dot /></LineChart></ResponsiveContainer></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Utilization (Last 90 Days)</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={utilizationTopCars}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" hide /><YAxis /><ReTooltip formatter={(v) => [`${v}`, "Booked days"]} /><Bar dataKey="bookedDays">{utilizationTopCars.map((r) => <Cell key={r.carNo} fill={hashColor("util-" + r.carNo)} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card></div><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Top Customers (Confirmed Client Net Revenue)</h2><table className="w-full text-sm"><tbody>{topCustomers.map((c) => <tr key={c.customerName} className="border-b"><td className="py-2 font-medium">{c.customerName}</td><td className="py-2 text-right">{currencyGH(c.total)}</td></tr>)}{!topCustomers.length && <tr><td className="py-3 text-gray-500">No confirmed bookings yet.</td></tr>}</tbody></table></CardContent></Card></>}

    {activeView === "dispatch" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div><h2 className="text-lg font-semibold">Dispatch Manifest - Next 14 Days</h2><div className="text-sm text-gray-600">Operational view for upcoming trips, drivers, vehicles, routes and supplier response status. Cancelled bookings are excluded.</div></div>
          <Button onClick={exportDispatchCSV} disabled={!can(role, "export")}>Export Dispatch CSV</Button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Upcoming Trip Lines</div><div className="text-xl font-bold">{dispatchSummary.totalTrips}</div></div>
          <div className="p-3 rounded-xl border bg-emerald-50"><div className="text-xs text-gray-500">Confirmed</div><div className="text-xl font-bold">{dispatchSummary.confirmed}</div></div>
          <div className="p-3 rounded-xl border bg-amber-50"><div className="text-xs text-gray-500">Pending</div><div className="text-xl font-bold">{dispatchSummary.pending}</div></div>
          <div className="p-3 rounded-xl border bg-blue-50"><div className="text-xs text-gray-500">Vehicles Involved</div><div className="text-xl font-bold">{dispatchSummary.uniqueCars}</div></div>
          <div className="p-3 rounded-xl border bg-violet-50"><div className="text-xs text-gray-500">Driver Assigned</div><div className="text-xl font-bold">{dispatchSummary.assignedDrivers}</div></div>
        </div>
        <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Trip Dates</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Vehicle</th><th className="py-2 pr-3">Route</th><th className="py-2 pr-3">Driver</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Status</th></tr></thead><tbody>{dispatchRows.map((row, idx) => { const badge = row.status === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : row.status === "pending" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-slate-50 text-slate-700 border-slate-200"; return <tr key={`${row.key}-${idx}`} className="border-b"><td className="py-2 pr-3"><b>{toISODateString(row.firstDate)}</b>{toISODateString(row.firstDate) !== toISODateString(row.lastDate) ? <span> → {toISODateString(row.lastDate)}</span> : null}<br /><span className="text-xs text-gray-500">{row.days} day(s)</span></td><td className="py-2 pr-3"><b>{row.customer}</b><br /><span className="text-xs text-gray-500">{row.customerPhone || row.customerEmail || "No contact"}</span></td><td className="py-2 pr-3">{row.carName}<br /><span className="text-xs text-gray-500">{row.carNumber}</span></td><td className="py-2 pr-3">{row.route}</td><td className="py-2 pr-3">{row.driver}<br /><span className="text-xs text-gray-500">{row.driverPhone || "No driver contact"}</span></td><td className="py-2 pr-3">{row.sourceName}<br /><span className="text-xs text-gray-500">Supplier response: {row.supplierResponseStatus}</span></td><td className="py-2 pr-3"><span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${badge}`}>{row.status}</span></td></tr>; })}{!dispatchRows.length && <tr><td colSpan={7} className="py-3 text-gray-500">No upcoming dispatch lines in the next 14 days.</td></tr>}</tbody></table></div>
      </CardContent></Card>
    </>}


    {activeView === "closeout" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div><h2 className="text-lg font-semibold">Trip Closeout & KM Capture</h2><div className="text-sm text-gray-600">Capture start/end odometer readings after trips. End KM updates the vehicle current odometer, which then drives KM-priority maintenance tracking.</div></div>
          <Button onClick={exportTripCloseoutCSV} disabled={!can(role, "export")}>Export Closeout CSV</Button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Trip Lines</div><div className="text-xl font-bold">{tripCloseoutSummary.total}</div></div>
          <div className="p-3 rounded-xl border bg-red-50"><div className="text-xs text-gray-500">Due for Closeout</div><div className="text-xl font-bold">{tripCloseoutSummary.due}</div></div>
          <div className="p-3 rounded-xl border bg-emerald-50"><div className="text-xs text-gray-500">Closed</div><div className="text-xl font-bold">{tripCloseoutSummary.closed}</div></div>
          <div className="p-3 rounded-xl border bg-blue-50"><div className="text-xs text-gray-500">Upcoming</div><div className="text-xl font-bold">{tripCloseoutSummary.upcoming}</div></div>
          <div className="p-3 rounded-xl border bg-violet-50"><div className="text-xs text-gray-500">Captured KM</div><div className="text-xl font-bold">{formatKm(tripCloseoutSummary.totalKmCaptured)}</div></div>
        </div>
        <Input placeholder="Search customer, vehicle, route, driver, supplier or status" value={tripCloseoutSearch} onChange={(e) => setTripCloseoutSearch(e.target.value)} />
        <div className="overflow-auto"><table className="w-full text-xs md:text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Trip</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Vehicle / Route</th><th className="py-2 pr-3">Driver</th><th className="py-2 pr-3">KM Capture</th><th className="py-2 pr-3">Fuel Treatment / Notes</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Action</th></tr></thead><tbody>{tripCloseoutRows.map((row, idx) => <tr key={`${row.key}-${idx}`} className="border-b align-top"><td className="py-2 pr-3"><b>{toISODateString(row.firstDate)}</b>{toISODateString(row.firstDate) !== toISODateString(row.lastDate) ? <span> → {toISODateString(row.lastDate)}</span> : null}<br /><span className="text-xs text-gray-500">{row.days} day(s)</span></td><td className="py-2 pr-3"><b>{row.customer}</b><br /><span className="text-xs text-gray-500">{row.customerPhone || "No contact"}</span></td><td className="py-2 pr-3"><b>{row.carName}</b><br /><span className="text-xs text-gray-500">{row.carNumber}</span><br />{row.route}<br /><span className="text-xs text-gray-500">Source: {row.sourceName}</span></td><td className="py-2 pr-3">{row.driver}<br /><span className="text-xs text-gray-500">{row.driverPhone || "No driver contact"}</span></td><td className="py-2 pr-3 min-w-[240px]"><div className="grid grid-cols-2 gap-1"><Input type="number" placeholder="Start KM" value={row.startKm} onChange={(e) => updateTripCloseoutDraft(row.key, { startKm: e.target.value })} /><Input type="number" placeholder="End KM" value={row.endKm} onChange={(e) => { const end = e.target.value; const start = tripCloseoutDrafts[row.key]?.startKm ?? row.startKm; updateTripCloseoutDraft(row.key, { endKm: end, kmCovered: kmNumber(end) && kmNumber(start) ? Math.max(0, kmNumber(end) - kmNumber(start)) : "" }); }} /><Input type="number" placeholder="KM Covered" value={row.kmCovered} onChange={(e) => updateTripCloseoutDraft(row.key, { kmCovered: e.target.value })} /><div className="text-xs p-2 rounded-lg bg-slate-50 border">Current: <b>{formatKm(row.currentOdometerKm)}</b></div></div></td><td className="py-2 pr-3 min-w-[280px]"><Input type="number" placeholder="Fuel amount, if captured" value={row.fuelCost} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelCost: e.target.value })} /><select className="border rounded-lg p-2 text-sm h-10 mt-1 w-full" value={row.fuelBillingMode || "client_paid_direct"} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelBillingMode: e.target.value })}><option value="client_paid_direct">Fuel paid directly by client/customer</option><option value="maalvila_reimbursable">MAALVILA paid fuel - bill client with receipt</option><option value="maalvila_absorbed">MAALVILA absorbs fuel as cost</option></select>{row.fuelBillingMode === "maalvila_reimbursable" && <div className="mt-2 space-y-1"><Input placeholder="Fuel receipt reference" value={row.fuelReceiptRef || ""} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelReceiptRef: e.target.value })} /><Input type="number" placeholder="Amount reimbursed by client" value={row.fuelReimbursedAmount || ""} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelReimbursedAmount: e.target.value })} /><div className="grid grid-cols-2 gap-1"><Input type="date" value={row.fuelReimbursementDate || ""} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelReimbursementDate: e.target.value })} /><Input placeholder="Reimbursement ref" value={row.fuelReimbursementRef || ""} onChange={(e) => updateTripCloseoutDraft(row.key, { fuelReimbursementRef: e.target.value })} /></div><div className="text-xs p-2 rounded-lg bg-blue-50 border border-blue-200">Receivable: <b>{currencyGH(row.fuelReceivable)}</b><br />Reimbursed: <b>{currencyGH(row.fuelReimbursed)}</b><br />Balance: <b>{currencyGH(row.fuelReceivableBalance)}</b><br />Status: <b>{row.fuelSettlementStatus}</b></div></div>}<Input className="mt-1" placeholder="Closeout notes" value={row.notes} onChange={(e) => updateTripCloseoutDraft(row.key, { notes: e.target.value })} /></td><td className="py-2 pr-3"><span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${row.statusClass}`}>{row.statusLabel}</span><br /><span className="text-xs text-gray-500">Booking: {row.bookingStatus}</span>{row.dispatchCloseoutByEmail ? <><br /><span className="text-xs text-gray-500">By: {row.dispatchCloseoutByEmail}</span></> : null}</td><td className="py-2 pr-3"><Button size="sm" onClick={() => saveTripCloseoutLine(row)} disabled={!can(role, "editBooking") && !can(role, "maintenance")}>Save Closeout</Button></td></tr>)}{!tripCloseoutRows.length && <tr><td colSpan={8} className="py-3 text-gray-500">No trip lines found for the closeout window.</td></tr>}</tbody></table></div>
      </CardContent></Card>
    </>}

    {activeView === "maintenance" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div><h2 className="text-lg font-semibold">Fleet Maintenance & Compliance Tracker</h2><div className="text-sm text-gray-600">KM/odometer tracking now takes priority over service dates. Dates remain for compliance and low-usage vehicle monitoring.</div></div>
          <Button onClick={exportMaintenanceCSV} disabled={!can(role, "export")}>Export Maintenance CSV</Button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Vehicles Tracked</div><div className="text-xl font-bold">{maintenanceSummary.total}</div></div>
          <div className="p-3 rounded-xl border bg-red-50"><div className="text-xs text-gray-500">Attention Required</div><div className="text-xl font-bold text-red-700">{maintenanceSummary.attention}</div></div>
          <div className="p-3 rounded-xl border bg-amber-50"><div className="text-xs text-gray-500">KM / Compliance Monitor</div><div className="text-xl font-bold text-amber-800">{maintenanceSummary.monitor}</div></div>
          <div className="p-3 rounded-xl border bg-emerald-50"><div className="text-xs text-gray-500">Good Standing</div><div className="text-xl font-bold text-emerald-700">{maintenanceSummary.good}</div></div>
        </div>
        <div className="rounded-xl border bg-blue-50 p-3 text-sm text-blue-900">Maintenance service priority is now based on odometer readings: Current KM, Last Service KM, Service Interval KM and Next Service KM. If Next Service KM is left blank, the system estimates it as Last Service KM + Service Interval KM.</div>
        <Input placeholder="Search vehicle, car number, source, kilometer reading or notes" value={maintenanceSearch} onChange={(e) => setMaintenanceSearch(e.target.value)} />
        <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Vehicle</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Overall</th><th className="py-2 pr-3">Current KM</th><th className="py-2 pr-3">Last Service KM / Date</th><th className="py-2 pr-3">Interval / Next KM</th><th className="py-2 pr-3">KM Service Status</th><th className="py-2 pr-3">Insurance Expiry</th><th className="py-2 pr-3">Roadworthy Expiry</th><th className="py-2 pr-3">Notes</th><th className="py-2 pr-3">Action</th></tr></thead><tbody>{maintenanceRows.map((row) => <tr key={row.rowKey} className="border-b align-top"><td className="py-2 pr-3"><b>{row.name}</b><br /><span className="text-xs text-gray-500">{row.number}</span></td><td className="py-2 pr-3">{row.sourceName || "—"}<br /><span className="text-xs text-gray-500">{sourceTypeLabel(row.sourceType)}</span></td><td className="py-2 pr-3"><span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${row.overallStatus.className}`}>{row.overallStatus.label}</span></td><td className="py-2 pr-3 min-w-[120px]"><Input type="number" placeholder="Current KM" value={getMaintenanceDraft(row).currentOdometerKm || ""} onChange={(e) => updateMaintenanceDraft(row.id, { currentOdometerKm: e.target.value })} /></td><td className="py-2 pr-3 min-w-[150px]"><Input type="number" placeholder="Last Service KM" value={getMaintenanceDraft(row).lastServiceKm || ""} onChange={(e) => updateMaintenanceDraft(row.id, { lastServiceKm: e.target.value })} /><Input className="mt-1" type="date" value={getMaintenanceDraft(row).lastServiceDate || ""} onChange={(e) => updateMaintenanceDraft(row.id, { lastServiceDate: e.target.value })} /></td><td className="py-2 pr-3 min-w-[150px]"><Input type="number" placeholder="Interval KM, e.g. 5000" value={getMaintenanceDraft(row).serviceIntervalKm || ""} onChange={(e) => updateMaintenanceDraft(row.id, { serviceIntervalKm: e.target.value })} /><Input className="mt-1" type="number" placeholder="Next Service KM" value={getMaintenanceDraft(row).nextServiceKm || ""} onChange={(e) => updateMaintenanceDraft(row.id, { nextServiceKm: e.target.value })} /><div className="text-xs text-gray-500 mt-1">Estimated next: {formatKm(row.kmServiceStatus.nextServiceKm)}</div></td><td className="py-2 pr-3"><div className={`inline-flex px-2 py-1 border rounded-xl text-xs ${row.kmServiceStatus.className}`}>{row.kmServiceStatus.label}</div><div className="text-xs text-gray-500 mt-1">Since service: {row.kmServiceStatus.kmSinceService !== null ? formatKm(row.kmServiceStatus.kmSinceService) : "—"}</div><div className="text-xs text-gray-500">Remaining: {row.kmServiceStatus.remainingKm !== null ? formatKm(row.kmServiceStatus.remainingKm) : "—"}</div><Input className="mt-1" type="date" value={getMaintenanceDraft(row).nextServiceDate || ""} onChange={(e) => updateMaintenanceDraft(row.id, { nextServiceDate: e.target.value })} /><div className={`inline-flex mt-1 px-2 py-1 border rounded-xl text-xs ${row.dateServiceStatus.className}`}>Date: {row.dateServiceStatus.label}{row.dateServiceStatus.days !== null ? ` (${row.dateServiceStatus.days}d)` : ""}</div></td><td className="py-2 pr-3"><Input type="date" value={getMaintenanceDraft(row).insuranceExpiry || ""} onChange={(e) => updateMaintenanceDraft(row.id, { insuranceExpiry: e.target.value })} /><div className={`inline-flex mt-1 px-2 py-1 border rounded-xl text-xs ${row.insuranceStatus.className}`}>{row.insuranceStatus.label}{row.insuranceStatus.days !== null ? ` (${row.insuranceStatus.days}d)` : ""}</div></td><td className="py-2 pr-3"><Input type="date" value={getMaintenanceDraft(row).roadworthyExpiry || ""} onChange={(e) => updateMaintenanceDraft(row.id, { roadworthyExpiry: e.target.value })} /><div className={`inline-flex mt-1 px-2 py-1 border rounded-xl text-xs ${row.roadworthyStatus.className}`}>{row.roadworthyStatus.label}{row.roadworthyStatus.days !== null ? ` (${row.roadworthyStatus.days}d)` : ""}</div></td><td className="py-2 pr-3 min-w-[180px]"><Input placeholder="Maintenance notes" value={getMaintenanceDraft(row).maintenanceNotes || ""} onChange={(e) => updateMaintenanceDraft(row.id, { maintenanceNotes: e.target.value })} /></td><td className="py-2 pr-3"><Button size="sm" onClick={() => saveMaintenanceForCar(row)} disabled={!can(role, "maintenance")}>Save</Button></td></tr>)}{!maintenanceRows.length && <tr><td colSpan={11} className="py-3 text-gray-500">No vehicle maintenance records found.</td></tr>}</tbody></table></div>
        <div className="text-xs text-gray-500">Only Admin can save maintenance and compliance records. Staff and viewers can review and export according to their role permissions.</div>
      </CardContent></Card>
    </>}

    {activeView === "reports" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Management Reports</h2><div className="text-sm text-gray-600">Summary reports for client balances, supplier payables and confirmed monthly performance. This view does not change the core KPI calculations.</div></div><Button onClick={exportReportsCSV} disabled={!can(role, "export")}>Export Reports CSV</Button></div><div className="grid md:grid-cols-4 gap-3 text-sm"><div className="p-3 rounded-xl border bg-blue-50">Client Outstanding<br /><b className="text-lg">{currencyGH(reportsSummary.clientOutstanding)}</b></div><div className="p-3 rounded-xl border bg-rose-50">Confirmed Balances<br /><b className="text-lg">{reportsSummary.overdueLikeCount}</b></div><div className="p-3 rounded-xl border bg-amber-50">Supplier Payable<br /><b className="text-lg">{currencyGH(reportsSummary.supplierPayable)}</b></div><div className="p-3 rounded-xl border bg-emerald-50">Confirmed Client Net<br /><b className="text-lg">{currencyGH(reportsSummary.monthlyClientNet)}</b></div></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Client Balances</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Vehicles</th><th className="py-2 pr-3">Dates</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3 text-right">Client Net</th><th className="py-2 pr-3 text-right">Paid</th><th className="py-2 pr-3 text-right">Balance</th></tr></thead><tbody>{clientBalanceRows.map((row, idx) => <tr key={`${row.bookingId}-${idx}`} className="border-b"><td className="py-2 pr-3 font-medium">{row.customer}</td><td className="py-2 pr-3 text-xs">{row.vehicles}</td><td className="py-2 pr-3 text-xs">{row.dates || "—"}</td><td className="py-2 pr-3">{row.paymentStatus}</td><td className="py-2 pr-3 text-right">{currencyGH(row.total)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.paid)}</td><td className="py-2 pr-3 text-right font-semibold">{currencyGH(row.balance)}</td></tr>)}{!clientBalanceRows.length && <tr><td colSpan={7} className="py-3 text-gray-500">No client balances available.</td></tr>}</tbody></table></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Supplier Payables by Source</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Supplier / Source</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3 text-right">Vehicle Lines</th><th className="py-2 pr-3 text-right">Gross Supplier</th><th className="py-2 pr-3 text-right">Discount Share</th><th className="py-2 pr-3 text-right">Net Payable</th><th className="py-2 pr-3 text-right">Admin Income</th></tr></thead><tbody>{supplierPayableRows.map((row, idx) => <tr key={`${row.sourceId}-${idx}`} className="border-b"><td className="py-2 pr-3 font-medium">{row.sourceName}</td><td className="py-2 pr-3">{sourceTypeLabel(row.sourceType)}</td><td className="py-2 pr-3 text-right">{row.vehicleLines}</td><td className="py-2 pr-3 text-right">{currencyGH(row.grossSupplier)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.discountShare)}</td><td className="py-2 pr-3 text-right font-semibold">{currencyGH(row.netPayable)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.adminIncome)}</td></tr>)}{!supplierPayableRows.length && <tr><td colSpan={7} className="py-3 text-gray-500">No confirmed supplier payables yet.</td></tr>}</tbody></table></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Monthly Confirmed Performance</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Month</th><th className="py-2 pr-3 text-right">Bookings</th><th className="py-2 pr-3 text-right">Client Net</th><th className="py-2 pr-3 text-right">Supplier Payable</th><th className="py-2 pr-3 text-right">Admin Income</th></tr></thead><tbody>{monthlyRevenueRows.map((row) => <tr key={row.monthKey} className="border-b"><td className="py-2 pr-3 font-medium">{row.monthKey}</td><td className="py-2 pr-3 text-right">{row.bookings}</td><td className="py-2 pr-3 text-right">{currencyGH(row.clientNet)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.supplierPayable)}</td><td className="py-2 pr-3 text-right font-semibold">{currencyGH(row.adminIncome)}</td></tr>)}{!monthlyRevenueRows.length && <tr><td colSpan={5} className="py-3 text-gray-500">No confirmed monthly performance data yet.</td></tr>}</tbody></table></div></CardContent></Card>
    </>}


    {activeView === "profitability" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Trip Profitability</h2><div className="text-sm text-gray-600">Compares client net against supplier payable and applies fuel only when MAALVILA absorbs it. Fuel paid directly by client does not affect MAALVILA profit. Fuel paid by MAALVILA for later billing is tracked as a receivable until reimbursed; it does not reduce trip profit unless management chooses to absorb it as a cost.</div></div><Button onClick={exportTripProfitabilityCSV} disabled={!can(role, "export")}>Export Profitability CSV</Button></div><Input placeholder="Search customer, vehicle, route, driver, source or status" value={profitabilitySearch} onChange={(e) => setProfitabilitySearch(e.target.value)} /><div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Trip Lines</div><div className="text-base md:text-lg font-bold leading-tight break-words">{tripProfitabilitySummary.totalTrips}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Client Net</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(tripProfitabilitySummary.totalClientNet)}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Supplier Payable</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(tripProfitabilitySummary.totalSupplierPayable)}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Fuel Captured</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(tripProfitabilitySummary.totalFuelCost)}</div><div className="text-[11px] text-gray-500 leading-tight">Cost to MAALVILA: {currencyGH(tripProfitabilitySummary.totalFuelCostToProfit)}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Fuel Receivable</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(tripProfitabilitySummary.totalFuelReceivable)}</div><div className="text-[11px] text-gray-500 leading-tight">Reimbursed: {currencyGH(tripProfitabilitySummary.totalFuelReimbursed)}</div><div className="text-[11px] text-gray-500 leading-tight">Balance: {currencyGH(tripProfitabilitySummary.totalFuelReceivableBalance)}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Trip Profit</div><div className={`text-base md:text-lg font-bold leading-tight break-words ${tripProfitabilitySummary.totalProfit < 0 ? "text-red-700" : "text-emerald-700"}`}>{currencyGH(tripProfitabilitySummary.totalProfit)}</div></CardContent></Card><Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Loss / Awaiting Closeout</div><div className="text-base md:text-lg font-bold leading-tight break-words">{tripProfitabilitySummary.lossTrips} / {tripProfitabilitySummary.awaitingCloseout}</div></CardContent></Card></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Trip</th><th className="py-2 pr-3">Vehicle / Route</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3 text-right">Client Net</th><th className="py-2 pr-3 text-right">Supplier Payable</th><th className="py-2 pr-3 text-right">Fuel Treatment</th><th className="py-2 pr-3 text-right">KM</th><th className="py-2 pr-3 text-right">Profit</th><th className="py-2 pr-3 text-right">Profit / KM</th><th className="py-2 pr-3">Status</th></tr></thead><tbody>{tripProfitabilityRows.map((row, idx) => <tr key={`${row.key}-${idx}`} className="border-b"><td className="py-2 pr-3"><b>{row.customer}</b><br /><span className="text-xs text-gray-500">{row.firstDate ? toISODateString(row.firstDate) : "—"} → {row.lastDate ? toISODateString(row.lastDate) : "—"}</span><br /><span className="text-xs text-gray-500">Driver: {row.driver}</span></td><td className="py-2 pr-3"><b>{row.carName}</b> ({row.carNumber})<br /><span className="text-xs text-gray-500">{row.route}</span></td><td className="py-2 pr-3">{row.sourceName}</td><td className="py-2 pr-3 text-right">{currencyGH(row.clientNet)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.supplierPayable)}</td><td className="py-2 pr-3 text-right">{row.fuelBillingMode === "maalvila_absorbed" ? <><b>{currencyGH(row.fuelCostToProfit)}</b><br /><span className="text-xs text-red-600">MAALVILA cost</span></> : row.fuelBillingMode === "maalvila_reimbursable" ? <><b>{currencyGH(row.fuelReceivable)}</b><br /><span className="text-xs text-blue-600">Bill client with receipt</span><br /><span className="text-xs text-gray-500">Paid: {currencyGH(row.fuelReimbursed)}</span><br /><span className={row.fuelReceivableBalance > 0 ? "text-xs text-amber-700" : "text-xs text-emerald-700"}>Balance: {currencyGH(row.fuelReceivableBalance)}</span><br /><span className="text-xs text-gray-500">{row.fuelSettlementStatus}</span></> : <><b>{currencyGH(row.fuelCost)}</b><br /><span className="text-xs text-gray-500">Client paid direct</span></>}</td><td className="py-2 pr-3 text-right">{row.kmCovered ? Number(row.kmCovered).toLocaleString() : "—"}</td><td className={`py-2 pr-3 text-right font-semibold ${row.tripProfit < 0 ? "text-red-700" : "text-emerald-700"}`}>{currencyGH(row.tripProfit)}<br /><span className="text-xs text-gray-500">{row.profitMarginPct.toFixed(1)}%</span></td><td className="py-2 pr-3 text-right">{row.kmCovered ? currencyGH(row.profitPerKm) : "—"}</td><td className="py-2 pr-3"><span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${row.statusClass}`}>{row.statusLabel}</span></td></tr>)}{!tripProfitabilityRows.length && <tr><td colSpan={10} className="py-3 text-gray-500">No trip profitability rows found.</td></tr>}</tbody></table></div><div className="text-xs text-gray-500">Note: Trip Profit = Client Net - Supplier Payable - MAALVILA-absorbed fuel cost only. Fuel paid directly by client is informational. Fuel paid by MAALVILA for later billing is tracked as a fuel receivable with receipt/reimbursement details until settled.</div></CardContent></Card>
    </>}


    {activeView === "fuelClaims" && <>
      <Card className="rounded-2xl shadow">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Fuel Claims Ledger</h2>
              <div className="text-sm text-gray-600">
                Tracks fuel paid by MAALVILA for clients who require reimbursement with fuel receipts. These amounts are receivables until the client/customer reimburses MAALVILA.
              </div>
            </div>
            <Button onClick={exportFuelClaimsCSV} disabled={!can(role, "export")}>Export Fuel Claims CSV</Button>
          </div>

          <Input
            placeholder="Search customer, vehicle, route, source, receipt ref or reimbursement ref"
            value={fuelClaimsSearch}
            onChange={(e) => setFuelClaimsSearch(e.target.value)}
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Fuel Claims</div><div className="text-base md:text-lg font-bold leading-tight break-words">{fuelClaimsSummary.totalClaims}</div></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Fuel Receivable</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(fuelClaimsSummary.totalReceivable)}</div></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Reimbursed</div><div className="text-base md:text-lg font-bold leading-tight break-words">{currencyGH(fuelClaimsSummary.totalReimbursed)}</div></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Balance</div><div className={`text-base md:text-lg font-bold leading-tight break-words ${fuelClaimsSummary.totalBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{currencyGH(fuelClaimsSummary.totalBalance)}</div></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Open Claims</div><div className="text-base md:text-lg font-bold leading-tight break-words">{fuelClaimsSummary.openClaims}</div></CardContent></Card>
            <Card className="rounded-xl"><CardContent className="p-3"><div className="text-xs text-gray-500">Settled Claims</div><div className="text-base md:text-lg font-bold leading-tight break-words">{fuelClaimsSummary.settledClaims}</div></CardContent></Card>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-gray-600">
                  <th className="py-2 pr-3">Trip / Customer</th>
                  <th className="py-2 pr-3">Vehicle / Route</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Receipt</th>
                  <th className="py-2 pr-3 text-right">Receivable</th>
                  <th className="py-2 pr-3 text-right">Reimbursed</th>
                  <th className="py-2 pr-3 text-right">Balance</th>
                  <th className="py-2 pr-3">Settlement</th>
                </tr>
              </thead>
              <tbody>
                {fuelClaimsRows.map((row, idx) => (
                  <tr key={`${row.key}-fuel-claim-${idx}`} className="border-b align-top">
                    <td className="py-2 pr-3">
                      <b>{row.customer}</b><br />
                      <span className="text-xs text-gray-500">{row.firstDate ? toISODateString(row.firstDate) : "—"} → {row.lastDate ? toISODateString(row.lastDate) : "—"}</span><br />
                      <span className="text-xs text-gray-500">Driver: {row.driver}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <b>{row.carName}</b> ({row.carNumber})<br />
                      <span className="text-xs text-gray-500">{row.route}</span>
                    </td>
                    <td className="py-2 pr-3">{row.sourceName}</td>
                    <td className="py-2 pr-3">
                      {row.fuelReceiptRef || <span className="text-amber-700">Receipt ref missing</span>}<br />
                      <span className="text-xs text-gray-500">Reimbursement ref: {row.fuelReimbursementRef || "—"}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">{currencyGH(row.fuelReceivable)}</td>
                    <td className="py-2 pr-3 text-right">{currencyGH(row.fuelReimbursed)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${row.fuelReceivableBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{currencyGH(row.fuelReceivableBalance)}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${row.fuelReceivableBalance > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                        {row.fuelSettlementStatus}
                      </span>
                      {row.fuelReimbursementDate ? <><br /><span className="text-xs text-gray-500">Date: {row.fuelReimbursementDate}</span></> : null}
                    </td>
                  </tr>
                ))}
                {!fuelClaimsRows.length && <tr><td colSpan={8} className="py-3 text-gray-500">No reimbursable fuel claims found. Fuel claims appear here when Trip Closeout is saved with “MAALVILA paid fuel - bill client with receipt”.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-gray-500">
            To update reimbursement amount/date/reference, open Trip Closeout for the affected trip and enter the reimbursement details. This ledger summarizes open and settled claims for management follow-up.
          </div>
        </CardContent>
      </Card>
    </>}


    {activeView === "launch" && <>
      <Card className="rounded-2xl shadow border bg-white">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Launch Readiness</h2>
              <div className="text-sm text-gray-600">Final operational hardening checklist for MAALVILA before controlled launch on Vercel.</div>
            </div>
            <div className="text-xs border rounded-xl px-3 py-2 bg-emerald-50 text-emerald-800 border-emerald-200">
              UI-only phase: no KPI changes, no business-calculation changes, no Firestore rules change.
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="rounded-xl border">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500">Technical Checks</div>
                <div className="text-2xl font-bold text-blue-700">5</div>
                <div className="text-xs text-gray-500">Pre-push and build readiness.</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500">Operations Checks</div>
                <div className="text-2xl font-bold text-emerald-700">8</div>
                <div className="text-xs text-gray-500">Booking-to-payment workflow.</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500">Data Cleanup</div>
                <div className="text-2xl font-bold text-amber-700">6</div>
                <div className="text-xs text-gray-500">Confirm before go-live.</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500">Launch Decision</div>
                <div className="text-2xl font-bold text-blue-700">Manual</div>
                <div className="text-xs text-gray-500">After successful build.</div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl border bg-slate-50">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">Technical Pre-Push Command Sequence</h3>
              <div className="text-sm text-gray-600">Run from <b>C:\Users\Paul\rental-system</b>.</div>
              <pre className="whitespace-pre-wrap text-xs bg-slate-900 text-slate-100 p-3 rounded-xl overflow-auto">{"npm run dev\nnpm run build\ngit status\ngit add components/Dashboard.jsx\ngit commit -m \"Phase 3Q launch readiness update\"\ngit push"}</pre>
              <div className="text-xs text-gray-500">Do not push if npm run build fails or if git status shows unintended files.</div>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="rounded-2xl border bg-slate-50">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Operational Workflow Checklist</h3>
                <div className="grid gap-2 text-sm">
                  {[
                    "Create multi-car booking",
                    "Confirm per-line VAT treatment",
                    "Generate Quote, Invoice and Receipt",
                    "Send Supplier Request and record Supplier Response",
                    "Record Client Payment and Supplier Payment",
                    "Close trip with KM and fuel billing treatment",
                    "Review Fuel Claims and Trip Profitability",
                    "Review Management Reports"
                  ].map((item, idx) => (
                    <label key={idx} className="flex gap-2 items-start">
                      <input type="checkbox" className="mt-1" /> <span>{item}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border bg-slate-50">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Firebase / Access Checklist</h3>
                <div className="grid gap-2 text-sm">
                  {[
                    "Authorized users can log in",
                    "Unauthorized users cannot access dashboard",
                    "Admin can manage Cars, Sources and Settings",
                    "Firestore collections load correctly",
                    "Vercel environment variables are confirmed",
                    "No Firestore rules change required"
                  ].map((item, idx) => (
                    <label key={idx} className="flex gap-2 items-start">
                      <input type="checkbox" className="mt-1" /> <span>{item}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border bg-slate-50">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">Data Cleanup Checklist</h3>
                <div className="grid gap-2 text-sm">
                  {[
                    "Resolve duplicate vehicle registration numbers",
                    "Confirm every vehicle has correct source/supplier",
                    "Clean customer autofill records",
                    "Cancel, remove, or clearly mark old test bookings",
                    "Confirm maintenance dates and KM fields are realistic",
                    "Confirm launch users and roles"
                  ].map((item, idx) => (
                    <label key={idx} className="flex gap-2 items-start">
                      <input type="checkbox" className="mt-1" /> <span>{item}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="overflow-auto border rounded-xl">
            <table className="w-full text-sm bg-white">
              <thead>
                <tr className="text-left bg-slate-50 border-b">
                  <th className="p-2">Area</th>
                  <th className="p-2">Check</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Technical", "Run npm run dev locally", "Manual", "Confirm dashboard loads without blocking console errors."],
                  ["Technical", "Run npm run build", "Manual", "Do not push if production build fails."],
                  ["Technical", "Run git status", "Manual", "Confirm only intended files changed."],
                  ["Operations", "Test booking with multiple vehicles", "Manual", "Confirm dates, routes, drivers and suppliers."],
                  ["Operations", "Test per-line VAT treatment", "Manual", "Confirm VAT Exclusive, Inclusive, No VAT and Exempt."],
                  ["Operations", "Test Quote, Invoice and Receipt", "Manual", "Confirm totals and VAT labels."],
                  ["Operations", "Test supplier workflow", "Manual", "Request, response, statement, payment and voucher."],
                  ["Operations", "Test trip closeout and profitability", "Manual", "Confirm KM and fuel treatment work correctly."],
                  ["Firebase / Access", "Confirm Firebase Auth", "Manual", "Authorized users can log in."],
                  ["Firebase / Access", "Confirm Firestore reads/writes", "Manual", "Existing collections continue to work."],
                  ["Vercel", "Confirm environment variables", "Manual", "NEXT_PUBLIC Firebase values must match working Firebase project."],
                  ["Data Cleanup", "Review vehicle and customer data", "Manual", "Clean test data before launch."],
                  ["Launch Decision", "Recommended launch decision", "Manual", "Proceed after successful build, QA and Vercel confirmation."]
                ].map((row, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="p-2 font-semibold">{row[0]}</td>
                    <td className="p-2">{row[1]}</td>
                    <td className="p-2"><span className="inline-flex px-2 py-1 border rounded-xl text-xs bg-blue-50 text-blue-700 border-blue-200">{row[2]}</span></td>
                    <td className="p-2 text-gray-600">{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Card className="rounded-2xl border bg-white">
            <CardContent className="p-4 space-y-2">
              <h3 className="font-semibold">Recommended Launch Decision Note</h3>
              <p className="text-sm text-gray-700">Proceed to controlled launch only after the local build succeeds, Vercel environment variables are confirmed, Firebase authenticated access is verified, and the operational workflow checklist is completed. This phase does not require Firestore rules changes and does not alter KPI calculations.</p>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </>}
    {activeView === "customers" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Customer Ledger & History</h2><div className="text-sm text-gray-600">A consolidated customer directory built from saved bookings. Use this to check repeat customers, balances, contact details and booking history without changing KPI calculations.</div></div><Button onClick={exportCustomerLedgerCSV} disabled={!can(role, "export")}>Export Customer Ledger CSV</Button></div><div className="grid md:grid-cols-4 gap-3 text-sm"><div className="p-3 rounded-xl border bg-blue-50">Total Customers<br /><b className="text-lg">{customerLedgerSummary.totalCustomers}</b></div><div className="p-3 rounded-xl border bg-rose-50">Customers With Balance<br /><b className="text-lg">{customerLedgerSummary.customersWithBalance}</b></div><div className="p-3 rounded-xl border bg-amber-50">Total Customer Balance<br /><b className="text-lg">{currencyGH(customerLedgerSummary.totalCustomerBalance)}</b></div><div className="p-3 rounded-xl border bg-emerald-50">Total Customer Net<br /><b className="text-lg">{currencyGH(customerLedgerSummary.totalCustomerNet)}</b></div></div><Input placeholder="Search customer, email, phone, car number or route" value={customerLedgerSearch} onChange={(e) => setCustomerLedgerSearch(e.target.value)} /></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Customer Directory</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3 text-right">Bookings</th><th className="py-2 pr-3 text-right">Vehicle Lines</th><th className="py-2 pr-3 text-right">Client Net</th><th className="py-2 pr-3 text-right">Paid</th><th className="py-2 pr-3 text-right">Balance</th><th className="py-2 pr-3">Last Activity</th></tr></thead><tbody>{filteredCustomerLedgerRows.map((row, idx) => <tr key={`${row.customerName}-${row.phone}-${idx}`} className="border-b align-top"><td className="py-2 pr-3 font-medium">{row.customerName}<br /><span className="text-xs text-gray-500">Channel: {row.preferredChannel || "email"}</span></td><td className="py-2 pr-3 text-xs">{row.email || "—"}<br />{row.phone || "—"}</td><td className="py-2 pr-3 text-right">{row.totalBookings}<br /><span className="text-xs text-gray-500">C:{row.confirmedBookings} P:{row.pendingBookings} X:{row.cancelledBookings}</span></td><td className="py-2 pr-3 text-right">{row.vehicleLines}</td><td className="py-2 pr-3 text-right">{currencyGH(row.totalClientNet)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.totalPaid)}</td><td className={`py-2 pr-3 text-right font-semibold ${row.totalBalance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{currencyGH(row.totalBalance)}</td><td className="py-2 pr-3 text-xs">{row.lastBookingDate ? toISODateString(row.lastBookingDate) : "—"}<br />{row.lastStatus || "—"}</td></tr>)}{!filteredCustomerLedgerRows.length && <tr><td colSpan={8} className="py-3 text-gray-500">No customers match the current search.</td></tr>}</tbody></table></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Customer Vehicles & Routes</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Cars Used</th><th className="py-2 pr-3">Routes Used</th><th className="py-2 pr-3 text-right">Admin Income</th><th className="py-2 pr-3 text-right">Supplier Payable</th></tr></thead><tbody>{filteredCustomerLedgerRows.map((row, idx) => <tr key={`route-${row.customerName}-${idx}`} className="border-b align-top"><td className="py-2 pr-3 font-medium">{row.customerName}</td><td className="py-2 pr-3 text-xs">{row.carNumbersText || "—"}</td><td className="py-2 pr-3 text-xs">{row.routesText || "—"}</td><td className="py-2 pr-3 text-right">{currencyGH(row.totalAdminIncome)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.totalSupplierPayable)}</td></tr>)}</tbody></table></div></CardContent></Card>
    </>}

    {activeView === "availability" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Fleet Availability Planner</h2><div className="text-sm text-gray-600">Shows booked and free days for each car over the next 30 days without changing any KPI calculations.</div></div><div className="text-xs text-gray-500">Tip: bookings with status <b>cancelled</b> are excluded.</div></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Vehicle</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3 text-right">Booked Days / 30</th><th className="py-2 pr-3 text-right">Free Days / 30</th><th className="py-2 pr-3">Next Booking</th></tr></thead><tbody>{availabilityRows.map((row, idx) => { const badge = row.status === "Fully booked" ? "bg-red-50 text-red-700 border-red-200" : row.status === "Partly booked" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"; return <tr key={`${row.carNumber || "car"}-${row.carName || "vehicle"}-${row.sourceId || row.sourceName || "source"}-${idx}`} className="border-b"><td className="py-2 pr-3"><b>{row.carName}</b><br /><span className="text-xs text-gray-500">{row.carNumber}</span></td><td className="py-2 pr-3">{row.sourceName}<br /><span className="text-xs text-gray-500">{sourceTypeLabel(row.sourceType)}</span></td><td className="py-2 pr-3"><span className={`inline-flex px-2 py-1 border rounded-xl text-xs ${badge}`}>{row.status}</span></td><td className="py-2 pr-3 text-right font-semibold">{row.bookedDaysNext30}</td><td className="py-2 pr-3 text-right font-semibold">{row.freeDaysNext30}</td><td className="py-2 pr-3 text-xs">{row.nextBooking ? <><b>{toISODateString(row.nextBooking.firstDate)}</b> • {row.nextBooking.customer}<br />{row.nextBooking.route} • {row.nextBooking.status}</> : <span className="text-gray-500">No upcoming booking</span>}</td></tr>; })}{!availabilityRows.length && <tr><td colSpan={6} className="py-3 text-gray-500">No cars available in the system.</td></tr>}</tbody></table></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Upcoming Booked Dates</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Vehicle</th><th className="py-2 pr-3">Route</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Status</th></tr></thead><tbody>{upcomingBookingsByDate.map((row, idx) => <tr key={`${row.dateKey}-${row.carNumber}-${idx}`} className="border-b"><td className="py-2 pr-3 font-semibold">{row.dateKey}</td><td className="py-2 pr-3">{row.customer}</td><td className="py-2 pr-3">{row.carName} ({row.carNumber})</td><td className="py-2 pr-3">{row.route}</td><td className="py-2 pr-3">{row.sourceName}</td><td className="py-2 pr-3">{row.status}</td></tr>)}{!upcomingBookingsByDate.length && <tr><td colSpan={6} className="py-3 text-gray-500">No upcoming booked dates.</td></tr>}</tbody></table></div></CardContent></Card>
    </>}


    {activeView === "suppliers" && <>
      <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Supplier Ledger & Source History</h2><div className="text-sm text-gray-600">A consolidated supplier ledger built from vehicle sources, confirmed booking lines and supplier payment audit entries. This does not change KPI calculations.</div></div><div className="flex flex-col md:flex-row gap-2"><Input placeholder="Search supplier, contact, car, route..." value={supplierLedgerSearch} onChange={(e) => setSupplierLedgerSearch(e.target.value)} /><Button onClick={exportSupplierLedgerCSV}>Export Supplier Ledger CSV</Button></div></div><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3"><div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Suppliers / Sources</div><div className="text-xl font-bold">{supplierLedgerSummary.totalSuppliers}</div></div><div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">With Balance</div><div className="text-xl font-bold">{supplierLedgerSummary.suppliersWithBalance}</div></div><div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Net Payable</div><div className="text-xl font-bold">{currencyGH(supplierLedgerSummary.totalSupplierPayable)}</div></div><div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Paid</div><div className="text-xl font-bold">{currencyGH(supplierLedgerSummary.totalSupplierPaid)}</div></div><div className="p-3 rounded-xl border bg-white"><div className="text-xs text-gray-500">Balance</div><div className="text-xl font-bold">{currencyGH(supplierLedgerSummary.totalSupplierBalance)}</div></div></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Supplier / Source</th><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3 text-right">Cars</th><th className="py-2 pr-3 text-right">Bookings</th><th className="py-2 pr-3 text-right">Lines</th><th className="py-2 pr-3 text-right">Net Payable</th><th className="py-2 pr-3 text-right">Paid</th><th className="py-2 pr-3 text-right">Balance</th><th className="py-2 pr-3">Last Activity</th></tr></thead><tbody>{filteredSupplierLedgerRows.map((row, idx) => <tr key={`${row.sourceId || row.sourceName}-${idx}`} className="border-b"><td className="py-2 pr-3"><b>{row.sourceName}</b><br /><span className="text-xs text-gray-500">{sourceTypeLabel(row.sourceType)}</span></td><td className="py-2 pr-3 text-xs">{row.contactPerson || "—"}<br />{row.phone || "—"}<br />{row.email || "—"}</td><td className="py-2 pr-3 text-right">{row.carsCount}</td><td className="py-2 pr-3 text-right">{row.totalBookings}<br /><span className="text-xs text-gray-500">C:{row.confirmedBookings} P:{row.pendingBookings} X:{row.cancelledBookings}</span></td><td className="py-2 pr-3 text-right">{row.vehicleLines}</td><td className="py-2 pr-3 text-right font-semibold">{currencyGH(row.netPayable)}</td><td className="py-2 pr-3 text-right">{currencyGH(row.paid)}<br /><span className="text-xs text-gray-500">{row.paymentCount} payment(s)</span></td><td className="py-2 pr-3 text-right font-semibold">{currencyGH(row.balance)}</td><td className="py-2 pr-3 text-xs">{row.lastBookingDate ? toISODateString(row.lastBookingDate) : "—"}</td></tr>)}{!filteredSupplierLedgerRows.length && <tr><td colSpan={9} className="py-3 text-gray-500">No supplier/source records match the search.</td></tr>}</tbody></table></div></CardContent></Card>
      <Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Supplier Vehicles & Routes</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b text-gray-600"><th className="py-2 pr-3">Supplier</th><th className="py-2 pr-3">Cars Used</th><th className="py-2 pr-3">Routes Served</th><th className="py-2 pr-3 text-right">Admin Income From Lines</th></tr></thead><tbody>{filteredSupplierLedgerRows.map((row, idx) => <tr key={`supplier-routes-${row.sourceId || row.sourceName}-${idx}`} className="border-b"><td className="py-2 pr-3 font-semibold">{row.sourceName}</td><td className="py-2 pr-3 text-xs">{row.carNumbersText || "—"}</td><td className="py-2 pr-3 text-xs">{row.routesText || "—"}</td><td className="py-2 pr-3 text-right">{currencyGH(row.adminIncome)}</td></tr>)}{!filteredSupplierLedgerRows.length && <tr><td colSpan={4} className="py-3 text-gray-500">No supplier route records found.</td></tr>}</tbody></table></div></CardContent></Card>
    </>}

    {activeView === "cars" && <><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><h2 className="text-lg font-semibold">Add Source / Supplier</h2>{can(role, "addSource") ? <><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Source Name" value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={newSourceType} onChange={(e) => setNewSourceType(e.target.value)}><option value="main">Main / MAALVILA</option><option value="rental_company">Attached Rental Company</option><option value="individual">Individual / Other</option></select><Input placeholder="Contact Person" value={newSourceContactPerson} onChange={(e) => setNewSourceContactPerson(e.target.value)} /><Input placeholder="Phone" value={newSourcePhone} onChange={(e) => setNewSourcePhone(e.target.value)} /><Input placeholder="Email" value={newSourceEmail} onChange={(e) => setNewSourceEmail(e.target.value)} /><Input placeholder="Address" value={newSourceAddress} onChange={(e) => setNewSourceAddress(e.target.value)} /></div><Button onClick={addSource}>Add Source</Button></> : <div className="text-sm text-gray-500">Only Admin can add sources.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><h2 className="text-lg font-semibold">Add Car</h2>{can(role, "addCar") ? <><div className="grid md:grid-cols-4 gap-2"><Input placeholder="Car Name" value={newCarName} onChange={(e) => setNewCarName(e.target.value)} /><Input placeholder="Car Number" value={newCarNumber} onChange={(e) => setNewCarNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={newCarSourceId} onChange={(e) => setNewCarSourceId(e.target.value)}><option value="">Select Source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.sourceName} — {sourceTypeLabel(s.sourceType)}</option>)}</select><Button onClick={addCar}>Add Car</Button></div></> : <div className="text-sm text-gray-500">Only Admin can add cars.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><h2 className="text-lg font-semibold">Fleet Data Quality Checks</h2><div className="text-sm text-gray-600">Flags duplicate registration numbers and cars without a valid source before they create scheduling confusion.</div></div><div className="text-xs text-gray-500">This section does not change KPI calculations.</div></div><div className="grid md:grid-cols-2 gap-3"><div className="border rounded-xl p-3 bg-white"><div className="font-semibold text-sm mb-2">Duplicate Car Numbers</div>{duplicateCarNumberGroups.length ? <div className="space-y-2">{duplicateCarNumberGroups.map((dup) => <div key={dup.normalizedNumber} className="text-sm p-2 rounded-lg bg-amber-50 border border-amber-200"><div className="font-semibold">{dup.normalizedNumber}</div><div className="text-xs text-gray-700">{dup.group.map((car) => `${car.name || "Unnamed"} — ${car.sourceName || "No source"}`).join(" | ")}</div></div>)}</div> : <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">No duplicate car numbers detected.</div>}</div><div className="border rounded-xl p-3 bg-white"><div className="font-semibold text-sm mb-2">Cars Without Valid Source</div>{unassignedCars.length ? <div className="space-y-2">{unassignedCars.map((car) => <div key={car.id || car.number} className="text-sm p-2 rounded-lg bg-rose-50 border border-rose-200"><b>{car.name || "Unnamed"}</b> ({car.number || "No number"})<div className="text-xs text-gray-700">Current source: {car.sourceName || "Not assigned"}</div></div>)}</div> : <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">All cars have valid sources.</div>}</div></div><div className="text-xs text-gray-500">For duplicate numbers already in Firestore, keep the correct vehicle and remove or correct the duplicate record manually in Firebase Console if needed.</div></CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Sources / Suppliers</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-600 border-b"><th className="py-2 pr-4">Source</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Cars</th><th className="py-2 pr-4">Bookings</th><th className="py-2 pr-4">Vehicle Lines</th><th className="py-2 pr-4">Supplier Payable</th><th className="py-2 pr-4">Admin Income</th></tr></thead><tbody>{sourceSummary.map((s) => <tr key={s.sourceId} className="border-b"><td className="py-2 pr-4 font-medium">{s.sourceName}</td><td className="py-2 pr-4"><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${sourceBadgeClass(s.sourceType)}`}>{sourceTypeLabel(s.sourceType)}</span></td><td>{s.cars}</td><td>{s.bookings}</td><td>{s.vehicleLines}</td><td>{currencyGH(s.netSupplierPayable)}</td><td>{currencyGH(s.adminIncome)}</td></tr>)}{!sourceSummary.length && <tr><td colSpan={7} className="py-3 text-gray-500">No sources added yet.</td></tr>}</tbody></table></div></CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Cars List</h2><table className="w-full text-sm"><tbody>{cars.map((c) => <tr key={c.id} className="border-b"><td className="py-2 font-medium">{c.name}</td><td>{c.number}</td><td>{c.sourceName || "Not assigned"}</td><td>{sourceTypeLabel(c.sourceType)}</td></tr>)}{!cars.length && <tr><td className="py-3 text-gray-500">No cars added yet.</td></tr>}</tbody></table></CardContent></Card></>}

    {activeView === "bookings" && <><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{editBookingId ? "Edit Multi-Car Booking" : "New Multi-Car Booking"}</h2><div className="text-xs text-gray-500">One client booking can now include multiple cars.</div></div>{can(role, "addBooking") ? <><div className="grid md:grid-cols-4 gap-2 items-start"><div className="space-y-1"><Input placeholder="Customer Name" list="existing-customer-list" value={customer} onChange={(e) => populateExistingCustomer(e.target.value)} /><datalist id="existing-customer-list">{customerDirectory.map((c) => <option key={`${c.name}-${c.email}-${c.phone}`} value={c.name}>{[c.email, c.phone].filter(Boolean).join(" • ")}</option>)}</datalist><div className="text-xs text-gray-500">Existing customer search: type or select from {customerDirectory.length} saved customer(s).</div></div><Input placeholder="Customer Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} /><Input placeholder="Customer Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}><option value="email">Email</option><option value="whatsapp" disabled>WhatsApp later</option><option value="sms" disabled>SMS later</option></select></div><div className="text-sm p-2 rounded-lg bg-white border">Client Net Preview: <b>{currencyGH(formTotals.totalNetClientAmount)}</b></div><div className="text-sm p-2 rounded-lg bg-amber-50 border border-amber-200">Enter route, driver, and trip days inside each vehicle line. Different cars can share the same dates or have different routes/dates.</div><div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Vehicle Line Items</h3><Button type="button" variant="outline" onClick={addBookingItem} className="gap-2"><Plus className="w-4 h-4" /> Add Car Line</Button></div>{bookingItems.map((item, idx) => { const computed = formItemsComputed.find((x) => x.itemId === item.itemId) || computeItemSplit(item, [], cars); return <Card key={item.itemId} className="rounded-xl border bg-white"><CardContent className="p-3 space-y-3"><div className="flex items-center justify-between"><div className="font-semibold text-sm">Vehicle Line {idx + 1}</div>{bookingItems.length > 1 && <Button variant="outline" size="sm" className="gap-2" onClick={() => removeBookingItem(item.itemId)}><Trash2 className="w-4 h-4" /> Remove</Button>}</div><div className="grid md:grid-cols-5 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={item.carNumber} onChange={(e) => { const c = cars.find((x) => String(x.number) === String(e.target.value)); const defaultSupplierPct = c?.sourceType === "main" ? 0 : 50; const defaultAdminPct = c?.sourceType === "main" ? 100 : 50; updateBookingItem(item.itemId, { carNumber: e.target.value, supplierDiscountSharePct: defaultSupplierPct, adminDiscountSharePct: defaultAdminPct }); }}><option value="">Select Car</option>{cars.map((c) => <option key={c.id} value={c.number}>{c.name} ({c.number}) — {c.sourceName || "No source"}</option>)}</select><Input placeholder="Travel From for this car" value={item.travelFrom || ""} onChange={(e) => updateBookingItem(item.itemId, { travelFrom: e.target.value })} /><Input placeholder="Travel To for this car" value={item.travelTo || ""} onChange={(e) => updateBookingItem(item.itemId, { travelTo: e.target.value })} /><Input placeholder="Driver for this car" value={item.driver || ""} onChange={(e) => updateBookingItem(item.itemId, { driver: e.target.value })} /><Input placeholder="Driver Contact" value={item.driverPhone || ""} onChange={(e) => updateBookingItem(item.itemId, { driverPhone: e.target.value })} /></div><div className="grid md:grid-cols-4 gap-2"><Input type="number" placeholder="Supplier Rate (GHS)" value={item.supplierRate} onChange={(e) => updateBookingItem(item.itemId, { supplierRate: e.target.value })} /><Input type="number" placeholder="MAALVILA Admin Charge (GHS)" value={item.adminCharge} onChange={(e) => updateBookingItem(item.itemId, { adminCharge: e.target.value })} /><select className="border rounded-lg p-2 text-sm h-10" value={item.clientVatMode || getDefaultClientVatMode(companyProfile)} onChange={(e) => updateBookingItem(item.itemId, { clientVatMode: e.target.value })}><option value="exclusive">VAT Exclusive - add tax on top</option><option value="inclusive">VAT Inclusive - extract tax from rate</option><option value="none">No VAT / VAT not required</option><option value="exempt">VAT Exempt client</option></select><div className="text-sm p-2 border rounded-lg bg-slate-50">Client Daily: <b>{currencyGH(computed.clientDailyRate)}</b></div></div><div className="grid md:grid-cols-5 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={item.discountType} onChange={(e) => updateBookingItem(item.itemId, { discountType: e.target.value, discountValue: e.target.value === "none" ? "" : item.discountValue })}><option value="none">No Discount</option><option value="fixed">Fixed Amount (GHS)</option><option value="percentage">Percentage of Client Gross (%)</option></select><Input type="number" placeholder={item.discountType === "fixed" ? "Discount Amount (GHS), e.g. 120" : item.discountType === "percentage" ? "Discount Rate %, e.g. 5" : "No Discount"} value={item.discountValue} disabled={item.discountType === "none"} onChange={(e) => updateBookingItem(item.itemId, { discountValue: e.target.value })} /><Input type="number" placeholder="Supplier Share %" value={item.supplierDiscountSharePct} onChange={(e) => updateBookingItem(item.itemId, { supplierDiscountSharePct: e.target.value })} /><Input type="number" placeholder="MAALVILA Share %" value={item.adminDiscountSharePct} onChange={(e) => updateBookingItem(item.itemId, { adminDiscountSharePct: e.target.value })} /><div className="text-xs p-2 border rounded-lg bg-slate-50">Shares: {Number(item.supplierDiscountSharePct || 0) + Number(item.adminDiscountSharePct || 0)}%</div></div><div className="border rounded-xl p-2 bg-white"><div className="text-sm font-medium flex items-center gap-2 mb-2"><CalendarDays className="w-4 h-4" />Trip Days for this car line</div><div className="inline-block border rounded-xl p-2 bg-white"><Calendar mode="multiple" selected={normalizeSelectedDates(item.selectedDates)} onSelect={(dates) => updateBookingItem(item.itemId, { selectedDates: normalizeSelectedDates(dates) })} className="rounded-lg" /></div><div className="text-xs text-gray-500 mt-2">Selected: {normalizeSelectedDates(item.selectedDates).map(toISODateString).join(", ") || "None"}</div></div><div className="grid md:grid-cols-4 gap-2 text-xs text-gray-700"><div className="p-2 rounded-lg bg-blue-50 border">Client Gross: <b>{currencyGH(computed.grossClientAmount)}</b><br />Discount: <b>{currencyGH(computed.discountAmount)}</b><br />Client Net: <b>{currencyGH(computed.netClientAmount)}</b></div><div className="p-2 rounded-lg bg-indigo-50 border">VAT Treatment: <b>{clientVatModeLabel(computed.clientVatMode)}</b><br />Tax: <b>{currencyGH(computed.taxAmount)}</b><br />Client Grand: <b>{currencyGH(computed.clientGrandTotal)}</b></div><div className="p-2 rounded-lg bg-rose-50 border">Supplier Gross: <b>{currencyGH(computed.grossSupplierAmount)}</b><br />Discount Share: <b>{currencyGH(computed.supplierDiscountShare)}</b><br />Payable: <b>{currencyGH(computed.netSupplierPayable)}</b></div><div className="p-2 rounded-lg bg-emerald-50 border">Admin Gross: <b>{currencyGH(computed.grossAdminAmount)}</b><br />Discount Share: <b>{currencyGH(computed.adminDiscountShare)}</b><br />Admin Income: <b>{currencyGH(computed.netAdminIncome)}</b></div></div></CardContent></Card>; })}</div><Card className="rounded-xl bg-slate-900 text-white"><CardContent className="p-3 grid md:grid-cols-4 gap-2 text-sm"><div>Client Gross: <b>{currencyGH(formTotals.totalGrossClientAmount)}</b></div><div>Total Discount: <b>{currencyGH(formTotals.totalDiscountAmount)}</b></div><div>Client Net: <b>{currencyGH(formTotals.totalNetClientAmount)}</b></div><div>VAT/NHIL/GETFund: <b>{currencyGH(formVatSummary.totalTax)}</b></div><div>Client Grand Total: <b>{currencyGH(formVatSummary.grandTotal)}</b></div><div>Supplier Payable: <b>{currencyGH(formTotals.totalNetSupplierPayable)}</b></div><div>Admin Income: <b>{currencyGH(formTotals.totalNetAdminIncome)}</b></div></CardContent></Card><div className="flex flex-wrap gap-2"><Button onClick={saveBooking}>{editBookingId ? "Update Booking" : "Save Multi-Car Booking"}</Button>{editBookingId && <Button variant="outline" onClick={resetBookingForm}>Cancel Edit</Button>}</div></> : <div className="text-sm text-gray-500">You do not have permission to add bookings.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><h2 className="text-lg font-semibold">Filter / Export</h2><div className="text-xs text-gray-500">Showing <b>{filteredBookings.length}</b> / {bookings.length} bookings</div></div><div className="grid md:grid-cols-7 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={filterCar} onChange={(e) => setFilterCar(e.target.value)}><option value="">All Cars</option>{cars.map((c) => <option key={c.id} value={c.number}>{c.name} ({c.number})</option>)}</select><select className="border rounded-lg p-2 text-sm h-10" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}><option value="">All Sources</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.sourceName} — {sourceTypeLabel(s.sourceType)}</option>)}</select><select className="border rounded-lg p-2 text-sm h-10" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="">All Statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select><Input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /><Input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /><Button onClick={exportCSV} disabled={!can(role, "export")}>Export CSV</Button><Button onClick={() => window.print()} variant="outline" disabled={!can(role, "export")}>Print</Button></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Bookings</h2><div className="space-y-3">{filteredBookings.map((b) => { const items = getBookingItems(b, cars); const totals = getBookingTotals(b, cars); const total = computeBookingTotalAmount(b, cars); const paid = clampMoney(b.amountPaid || 0); const balance = Math.max(0, total - paid); const payStatus = b.paymentStatus || computePaymentStatus(total, paid); const statusClass = b.status === "confirmed" ? "text-green-700 bg-green-50 border-green-200" : b.status === "pending" ? "text-yellow-800 bg-yellow-50 border-yellow-200" : "text-red-700 bg-red-50 border-red-200"; const payClass = payStatus === "paid" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : payStatus === "partial" ? "text-violet-800 bg-violet-50 border-violet-200" : "text-slate-700 bg-slate-50 border-slate-200"; const supplierSources = Array.from(new Set(items.map((i) => i.sourceId).filter(Boolean))); return <div key={b.id} className="border rounded-2xl p-3 bg-white hover:shadow-sm transition"><div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2"><div className="space-y-2 flex-1"><div className="font-semibold text-lg">{b.customer}</div><div className="text-sm text-gray-700">Routes Summary: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="text-sm text-gray-700">Contact: <b>{b.customerEmail || "—"}</b>{b.customerPhone ? <span> • {b.customerPhone}</span> : null}</div><div className="text-sm text-gray-700">Booking Dates Summary: <span className="font-medium">{computeBookingDateSummary(items).map(toISODateString).join(", ")}</span></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2">Source</th><th className="p-2 text-right">Supplier Payable</th><th className="p-2 text-right">Admin Income</th><th className="p-2 text-right">Client Net</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2"><b>{i.carName}</b> ({i.carNumber})</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2">{i.sourceName || "—"}</td><td className="p-2 text-right">{currencyGH(i.netSupplierPayable)}</td><td className="p-2 text-right">{currencyGH(i.netAdminIncome)}</td><td className="p-2 text-right font-medium">{currencyGH(i.netClientAmount)}</td></tr>)}</tbody></table></div><div className="flex flex-wrap gap-2 text-sm"><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${statusClass}`}>Status: {b.status || "pending"}</span><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${payClass}`}>Payment: {payStatus}</span><span className="inline-flex items-center px-2 py-1 border rounded-xl text-xs bg-slate-50">Vehicle Lines: {items.length}</span></div><div className="grid md:grid-cols-3 gap-2 text-xs"><div className="p-2 rounded-lg bg-blue-50 border">Client Gross: <b>{currencyGH(totals.totalGrossClientAmount)}</b><br />Discount: <b>{currencyGH(totals.totalDiscountAmount)}</b><br />Client Net: <b>{currencyGH(totals.totalNetClientAmount)}</b></div><div className="p-2 rounded-lg bg-rose-50 border">Supplier Payable: <b>{currencyGH(totals.totalNetSupplierPayable)}</b></div><div className="p-2 rounded-lg bg-emerald-50 border">Admin Income: <b>{currencyGH(totals.totalNetAdminIncome)}</b><br />Paid: <b>{currencyGH(paid)}</b><br />Balance: <b>{currencyGH(balance)}</b></div></div></div><div className="flex flex-wrap gap-2 md:justify-end">{can(role, "confirmBooking") && b.status === "pending" && <Button onClick={() => confirmBooking(b)}>Confirm</Button>}{can(role, "cancelBooking") && b.status !== "cancelled" && <Button variant="destructive" onClick={() => cancelBooking(b)}>Cancel</Button>}{can(role, "editBooking") && <Button variant="outline" onClick={() => editBooking(b)}>Edit</Button>}{can(role, "recordPayment") && <Button variant="outline" onClick={() => openPayment(b)}>Record Payment</Button>}{can(role, "recordSupplierPayment") && <Button variant="outline" className="gap-2" onClick={() => openSupplierPayment(b)}><Banknote className="w-4 h-4" /> Supplier Payment</Button>}<Button variant="outline" className="gap-2" onClick={() => openQuotation(b)}><ScrollText className="w-4 h-4" /> Quote</Button><Button variant="outline" className="gap-2" onClick={() => openInvoice(b)}><FileText className="w-4 h-4" /> Invoice</Button><Button variant="outline" className="gap-2" onClick={() => openReceipt(b)}><ReceiptText className="w-4 h-4" /> Receipt</Button>{supplierSources.length > 0 && <Button variant="outline" className="gap-2" onClick={() => openSupplierRequest(b)}><UsersRound className="w-4 h-4" /> Supplier Request</Button>}<Button variant="outline" className="gap-2 border-blue-300 text-blue-700" onClick={() => openSupplierResponse(b)}><UsersRound className="w-4 h-4" /> Supplier Response</Button>{supplierSources.length > 0 && <Button variant="outline" className="gap-2" onClick={() => openSupplierVoucher(b)}><ReceiptText className="w-4 h-4" /> Supplier Voucher</Button>}{supplierSources.length > 0 && <Button variant="outline" className="gap-2" onClick={() => openSupplierStatement(b)}><UsersRound className="w-4 h-4" /> Supplier Statement</Button>}</div></div></div>; })}{!filteredBookings.length && <div className="text-sm text-gray-500">No bookings match your filter.</div>}</div></CardContent></Card>{paymentOpen && paymentBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Record Payment</h2><Button variant="outline" onClick={() => setPaymentOpen(false)}>Close</Button></div><div className="text-sm text-gray-700">Booking: <b>{paymentBooking.customer}</b> • Client Net: <b>{currencyGH(computeBookingTotalAmount(paymentBooking, cars))}</b></div><div className="grid md:grid-cols-5 gap-2"><Input type="number" placeholder="Amount (GH₵)" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="card">Card</option></select><Input placeholder="Reference" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /><Input placeholder="Note" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /><Button onClick={recordPayment}>Save Payment</Button></div><div><h3 className="font-semibold text-sm mb-2">Payment History</h3>{paymentHistory.map((p) => <div key={p.id} className="text-sm border rounded-xl p-2 bg-white mb-2"><div className="font-medium">{currencyGH(p.amount)} • {p.method || "cash"}{p.reference ? ` • Ref: ${p.reference}` : ""}</div>{p.note ? <div className="text-xs text-gray-600">{p.note}</div> : null}<div className="text-xs text-gray-500">{safeTimeToLocaleString(p.paidAt)} • by {p.recordedByEmail || "unknown"}</div></div>)}{!paymentHistory.length && <div className="text-sm text-gray-500">No payments recorded yet.</div>}</div></CardContent></Card>}{supplierPaymentOpen && supplierPaymentBooking && <Card className="rounded-2xl border-2 border-rose-200"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Record Supplier Payment</h2><Button variant="outline" onClick={() => setSupplierPaymentOpen(false)}>Close</Button></div><div className="text-sm text-gray-700">Booking: <b>{supplierPaymentBooking.customer}</b></div><div className="grid md:grid-cols-6 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={supplierPaymentSourceId} onChange={(e) => setSupplierPaymentSourceId(e.target.value)}><option value="">Select Supplier</option>{Array.from(new Set(getBookingItems(supplierPaymentBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Input type="number" placeholder="Supplier Payment Amount (GHS)" value={supplierPaymentAmount} onChange={(e) => setSupplierPaymentAmount(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierPaymentMethod} onChange={(e) => setSupplierPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="card">Card</option></select><Input placeholder="Reference" value={supplierPaymentReference} onChange={(e) => setSupplierPaymentReference(e.target.value)} /><Input placeholder="Note" value={supplierPaymentNote} onChange={(e) => setSupplierPaymentNote(e.target.value)} /><Button onClick={recordSupplierPayment}>Save Supplier Payment</Button></div><div><h3 className="font-semibold text-sm mb-2">Supplier Payment History</h3>{supplierPaymentHistory.filter((p) => !supplierPaymentSourceId || String(p.sourceId || "") === String(supplierPaymentSourceId)).map((p) => <div key={p.id} className="text-sm border rounded-xl p-2 bg-white mb-2"><div className="font-medium">{p.sourceName ? `${p.sourceName} • ` : ""}{currencyGH(p.amount)} • {p.method || "cash"}{p.reference ? ` • Ref: ${p.reference}` : ""}</div>{p.note ? <div className="text-xs text-gray-600">{p.note}</div> : null}<div className="text-xs text-gray-500">{safeTimeToLocaleString(p.paidAt)} • by {p.recordedByEmail || "unknown"}</div></div>)}{!supplierPaymentHistory.filter((p) => !supplierPaymentSourceId || String(p.sourceId || "") === String(supplierPaymentSourceId)).length && <div className="text-sm text-gray-500">No supplier payments recorded yet.</div>}</div></CardContent></Card>}</>}

    {activeView === "documents" && <>{!quotationOpen && !invoiceOpen && !receiptOpen && !supplierRequestOpen && !supplierResponseOpen && !supplierVoucherOpen && !supplierStatementOpen && <Card className="rounded-2xl shadow"><CardContent className="p-4 text-sm text-gray-600">Open the <b>Bookings</b> tab and click <b>Quote</b>, <b>Invoice</b>, <b>Receipt</b>, <b>Supplier Request</b>, <b>Supplier Response</b>, <b>Supplier Voucher</b>, or <b>Supplier Statement</b> on a booking to generate a document. Supplier Response is now shown as a booking action button.</CardContent></Card>}{quotationOpen && quotationBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Quotation Generator</h2><Button variant="outline" onClick={() => setQuotationOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Quotation Number" value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} /><Input placeholder="Quotation notes / terms" value={quotationNotes} onChange={(e) => setQuotationNotes(e.target.value)} /><Button onClick={saveQuotationToAudit}>Save + Email Quote</Button></div><ClientDocumentPreview type="Quotation" number={quotationNumber} booking={quotationBooking} notes={quotationNotes} /></CardContent></Card>}{invoiceOpen && invoiceBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Invoice Generator</h2><Button variant="outline" onClick={() => setInvoiceOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Invoice Number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /><Input placeholder="Notes / footer" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} /><Button onClick={saveInvoiceToAudit}>Save + Email Invoice</Button></div><ClientDocumentPreview type="Invoice" number={invoiceNumber} booking={invoiceBooking} notes={invoiceNotes} /></CardContent></Card>}{receiptOpen && receiptBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Receipt Generator</h2><Button variant="outline" onClick={() => setReceiptOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Receipt Number" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} /><Input placeholder="Receipt notes / footer" value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} /><Button onClick={saveReceiptToAudit}>Save + Email Receipt</Button></div><ClientDocumentPreview type="Receipt" number={receiptNumber} booking={receiptBooking} notes={receiptNotes} /></CardContent></Card>}{supplierRequestOpen && supplierRequestBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Supplier Request Generator</h2><Button variant="outline" onClick={() => setSupplierRequestOpen(false)}>Close</Button></div><div className="grid md:grid-cols-4 gap-2"><Input placeholder="Request Number" value={supplierRequestNumber} onChange={(e) => setSupplierRequestNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierRequestSourceId} onChange={(e) => setSupplierRequestSourceId(e.target.value)}>{Array.from(new Set(getBookingItems(supplierRequestBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Input placeholder="Request notes" value={supplierRequestNotes} onChange={(e) => setSupplierRequestNotes(e.target.value)} /><Button onClick={saveSupplierRequestToAudit}>Save + Email Supplier Request</Button></div><SupplierRequestPreview booking={supplierRequestBooking} sourceId={supplierRequestSourceId} number={supplierRequestNumber} notes={supplierRequestNotes} /></CardContent></Card>}{supplierResponseOpen && supplierResponseBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Supplier Response Capture</h2><Button variant="outline" onClick={() => setSupplierResponseOpen(false)}>Close</Button></div><div className="grid md:grid-cols-4 gap-2"><Input placeholder="Response Number" value={supplierResponseNumber} onChange={(e) => setSupplierResponseNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierResponseSourceId} onChange={(e) => { const sourceId = e.target.value; setSupplierResponseSourceId(sourceId); const items = getBookingItems(supplierResponseBooking, cars).filter((i) => i.sourceId === sourceId); setSupplierResponseLines(items.map((i) => ({ itemId: i.itemId, requestedCarName: i.carName || "", requestedCarNumber: i.carNumber || "", confirmedCarName: i.confirmedCarName || i.supplierConfirmedCarName || "", confirmedCarNumber: i.confirmedCarNumber || i.supplierConfirmedCarNumber || "", confirmedDriverName: i.confirmedDriverName || i.supplierConfirmedDriverName || i.driver || "", confirmedDriverPhone: i.confirmedDriverPhone || i.supplierConfirmedDriverPhone || i.driverPhone || "", confirmedSupplierRate: i.confirmedSupplierRate || i.supplierConfirmedRate || i.supplierRate || "", responseStatus: i.supplierResponseStatus || "confirmed", supplierNotes: i.supplierResponseNotes || "" }))); }}>{Array.from(new Set(getBookingItems(supplierResponseBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Input placeholder="General response notes" value={supplierResponseNotes} onChange={(e) => setSupplierResponseNotes(e.target.value)} /><Button onClick={saveSupplierResponseToAudit}>Save Supplier Response</Button></div><SupplierResponseCapture booking={supplierResponseBooking} sourceId={supplierResponseSourceId} number={supplierResponseNumber} notes={supplierResponseNotes} /></CardContent></Card>}{supplierVoucherOpen && supplierVoucherBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Supplier Settlement Voucher</h2><Button variant="outline" onClick={() => setSupplierVoucherOpen(false)}>Close</Button></div><div className="grid md:grid-cols-4 gap-2"><Input placeholder="Voucher Number" value={supplierVoucherNumber} onChange={(e) => setSupplierVoucherNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierVoucherSourceId} onChange={(e) => setSupplierVoucherSourceId(e.target.value)}>{Array.from(new Set(getBookingItems(supplierVoucherBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Input placeholder="Voucher notes" value={supplierVoucherNotes} onChange={(e) => setSupplierVoucherNotes(e.target.value)} /><Button onClick={saveSupplierVoucherToAudit}>Save Supplier Voucher</Button></div><SupplierVoucherPreview booking={supplierVoucherBooking} sourceId={supplierVoucherSourceId} number={supplierVoucherNumber} notes={supplierVoucherNotes} /></CardContent></Card>}{supplierStatementOpen && supplierStatementBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Supplier Statement Generator</h2><Button variant="outline" onClick={() => setSupplierStatementOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Statement Number" value={supplierStatementNumber} onChange={(e) => setSupplierStatementNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierStatementSourceId} onChange={(e) => setSupplierStatementSourceId(e.target.value)}>{Array.from(new Set(getBookingItems(supplierStatementBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Button onClick={saveSupplierStatementToAudit}>Save Supplier Statement</Button></div><SupplierStatementPreview booking={supplierStatementBooking} sourceId={supplierStatementSourceId} number={supplierStatementNumber} /></CardContent></Card>}</>}

    {activeView === "settings" && <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex items-center gap-2"><Building2 className="w-5 h-5" /><h2 className="text-lg font-semibold">Company Profile & Document Settings</h2></div><div className="grid md:grid-cols-2 gap-3">{[["Company Name", "companyName"], ["Company Email", "companyEmail"], ["Company Phone", "companyPhone"], ["Company Address", "companyAddress"], ["TIN", "companyTin"], ["VAT Registration Number", "vatNumber"], ["Logo URL e.g. /maalvila-Logo.jpg.png", "logoUrl"], ["Letterhead URL e.g. /MAALVILA-letterhead.jpg.png", "letterheadUrl"]].map(([ph, key]) => <Input key={key} placeholder={ph} value={companyProfile[key] || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, [key]: e.target.value }))} />)}<select className="border rounded-lg p-2 text-sm h-10" value={companyProfile.vatEnabled ? "yes" : "no"} onChange={(e) => setCompanyProfile((p) => ({ ...p, vatEnabled: e.target.value === "yes" }))}><option value="yes">Default VAT Enabled for New Lines</option><option value="no">Default VAT Disabled for New Lines</option></select><select className="border rounded-lg p-2 text-sm h-10" value={companyProfile.vatMode || "exclusive"} onChange={(e) => setCompanyProfile((p) => ({ ...p, vatMode: e.target.value }))}><option value="exclusive">Default VAT Exclusive Pricing</option><option value="inclusive">Default VAT Inclusive Pricing - extract tax from agreed rate</option></select></div><div className="grid gap-3"><Input placeholder="Quotation Terms" value={companyProfile.quotationTerms || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, quotationTerms: e.target.value }))} /><Input placeholder="Invoice Footer" value={companyProfile.invoiceFooter || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, invoiceFooter: e.target.value }))} /><Input placeholder="Receipt Footer" value={companyProfile.receiptFooter || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, receiptFooter: e.target.value }))} /></div><div className="rounded-xl border bg-white p-3 text-sm text-gray-600">Ghana VAT-ready format: VAT 15%, NHIL 2.5%, GETFund 2.5%. Current client VAT mode: {vatModeLabel(companyProfile.vatEnabled, companyProfile.vatMode || "exclusive")}</div><Button onClick={saveCompanyProfile} disabled={savingProfile || !can(role, "settings")}>{savingProfile ? "Saving..." : "Save Company Settings"}</Button></CardContent></Card>}

    {activeView === "audit" && <Card className="rounded-2xl"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Audit Trail</h2><div className="space-y-2">{audit.map((a) => <div key={a.id} className="text-sm border-b py-2"><div className="font-medium">{a.action}</div><div className="text-xs text-gray-500">User: <b>{a.userId || a.createdByEmail || roleEmail || user.email || "unknown"}</b> {a.uid ? <span>• UID: {a.uid}</span> : null} • {safeTimeToLocaleString(a.time) || "—"}{a.invoiceNumber ? <span> • Invoice: {a.invoiceNumber}</span> : null}{a.quotationNumber ? <span> • Quote: {a.quotationNumber}</span> : null}{a.supplierStatementNumber ? <span> • Supplier Statement: {a.supplierStatementNumber}</span> : null}{a.supplierResponseNumber ? <span> • Supplier Response: {a.supplierResponseNumber}</span> : null}{a.supplierVoucherNumber ? <span> • Supplier Voucher: {a.supplierVoucherNumber}</span> : null}{a.supplierPaymentAmount ? <span> • Supplier Payment: {currencyGH(a.supplierPaymentAmount)}</span> : null}</div></div>)}{!audit.length && <div className="text-sm text-gray-500">No audit events yet.</div>}</div></CardContent></Card>}
  </div>;
}
