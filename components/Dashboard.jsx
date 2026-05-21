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
function computeGhanaVatSummary(baseAmount, discountAmount = 0, vatEnabled = true) {
  const subtotal = clampMoney(baseAmount);
  const discount = Math.min(clampMoney(discountAmount), subtotal);
  const taxableAmount = Math.max(0, subtotal - discount);
  if (!vatEnabled) return { subtotal, discount, taxableAmount, vat: 0, nhil: 0, getfund: 0, totalTax: 0, grandTotal: taxableAmount };
  const vat = taxableAmount * GHANA_VAT_RATE;
  const nhil = taxableAmount * GHANA_NHIL_RATE;
  const getfund = taxableAmount * GHANA_GETFUND_RATE;
  return { subtotal, discount, taxableAmount, vat, nhil, getfund, totalTax: vat + nhil + getfund, grandTotal: taxableAmount + vat + nhil + getfund };
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
    selectedDates: itemDates,
    dateText: itemDates.map(toISODateString).join(", "),
    supplierRate,
    adminCharge,
    clientDailyRate,
    discountType,
    discountValue: Number.isFinite(discountValue) ? discountValue : 0,
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
  }), emptyPricingTotals());
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
    export: ["admin", "staff", "viewer"],
    settings: ["admin"],
  };
  return (map[action] || []).includes(r);
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
  const [trendMode, setTrendMode] = useState("monthly");

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

  const formItemsComputed = useMemo(() => bookingItems.map((item) => computeItemSplit(item, [], cars)), [bookingItems, cars]);
  const formTotals = useMemo(() => computePricingTotals(formItemsComputed), [formItemsComputed]);

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
    if (cars.some((c) => String(c.number) === String(newCarNumber))) return alert("Duplicate car number is not allowed.");
    const s = sources.find((x) => x.id === newCarSourceId);
    await addDoc(collection(db, "cars"), { name: newCarName.trim(), number: newCarNumber.trim(), sourceId: s?.id || "", sourceName: s?.sourceName || "", sourceType: s?.sourceType || "main", createdAt: serverTimestamp(), createdBy: user?.uid || "", createdByEmail: user?.email || "" });
    await addDoc(collection(db, "audit"), { action: `Car added: ${newCarName} (${newCarNumber}) — Source: ${s?.sourceName || "Unknown"}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp() });
    setNewCarName(""); setNewCarNumber(""); setNewCarSourceId("");
  };
  const resetBookingForm = () => {
    setCustomer(""); setCustomerEmail(""); setCustomerPhone(""); setTravelFrom(""); setTravelTo(""); setPreferredChannel("email"); setDriver(""); setDriverPhone(""); setSelectedDates([]); setBookingItems([blankBookingItem()]); setEditBookingId(null);
  };
  const updateBookingItem = (itemId, patch) => setBookingItems((items) => items.map((item) => item.itemId === itemId ? { ...item, ...patch } : item));
  const addBookingItem = () => setBookingItems((items) => [...items, blankBookingItem()]);
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
      const conflict = bookings.some((b) => {
        if (b.id === editBookingId || b.status === "cancelled") return false;
        return getBookingItems(b, cars).some((existingItem) => {
          if (String(existingItem.carNumber) !== String(item.carNumber)) return false;
          const existingDates = normalizeSelectedDates(existingItem.selectedDates);
          return existingDates.some((ed) => newDates.some((sd) => sameDay(ed, sd)));
        });
      });
      if (conflict) return `Conflict: car ${item.carNumber} is already booked on at least one selected date.`;
    }
    return "";
  };
  const saveBooking = async () => {
    if (!can(role, "addBooking") && !can(role, "editBooking")) return alert("You do not have permission to add/edit bookings.");
    const error = validateBooking();
    if (error) return alert(error);
    const computedItems = bookingItems.map((item) => computeItemSplit(item, [], cars));
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
    setBookingItems(getBookingItems(b, cars).map((item) => ({ ...item, selectedDates: normalizeSelectedDates(item.selectedDates), travelFrom: item.travelFrom || b.travelFrom || "", travelTo: item.travelTo || b.travelTo || "", driver: item.driver || b.driver || "", driverPhone: item.driverPhone || b.driverPhone || "", supplierRate: String(item.supplierRate ?? ""), adminCharge: String(item.adminCharge ?? ""), discountValue: item.discountType === "none" ? "" : String(item.discountValue ?? ""), supplierDiscountSharePct: String(item.supplierDiscountSharePct ?? 50), adminDiscountSharePct: String(item.adminDiscountSharePct ?? 50) })));
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
  const openQuotation = (b) => { setQuotationBooking(b); setQuotationNumber(generateDocNumber("QUO")); setQuotationNotes(companyProfile.quotationTerms || ""); setActiveView("documents"); setQuotationOpen(true); setInvoiceOpen(false); setSupplierStatementOpen(false); };
  const openInvoice = (b) => { setInvoiceBooking(b); setInvoiceNumber(generateDocNumber("INV")); setInvoiceNotes(companyProfile.invoiceFooter || ""); setActiveView("documents"); setInvoiceOpen(true); setQuotationOpen(false); setSupplierStatementOpen(false); };
  const openSupplierStatement = (b, sourceId = "") => {
    const items = getBookingItems(b, cars);
    const firstSource = sourceId || items.find((i) => i.sourceId)?.sourceId || "";
    setSupplierStatementBooking(b);
    setSupplierStatementSourceId(firstSource);
    setSupplierStatementNumber(generateDocNumber("SUP"));
    setActiveView("documents");
    setSupplierStatementOpen(true);
    setQuotationOpen(false);
    setInvoiceOpen(false);
  };
  const saveQuotationToAudit = async () => {
    if (!quotationBooking) return;
    const totals = getBookingTotals(quotationBooking, cars);
    const vat = computeGhanaVatSummary(totals.totalGrossClientAmount, totals.totalDiscountAmount, companyProfile.vatEnabled);
    await addDoc(collection(db, "audit"), { action: `Quotation generated (${quotationNumber}) for ${quotationBooking.customer} — Vehicles ${getBookingItems(quotationBooking, cars).length} — Total ${currencyGH(vat.grandTotal)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), quotationNumber, bookingId: quotationBooking.id, documentType: "quotation", vatSummary: vat });
    await sendEmailNotification({ toEmail: quotationBooking.customerEmail, bookingId: quotationBooking.id, actionType: "quotation_generated", subject: `Quotation ${quotationNumber} - ${quotationBooking.customer || "Customer"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nQUOTATION\nQuotation No: ${quotationNumber}\nCustomer: ${quotationBooking.customer || ""}\nVehicles: ${getBookingItems(quotationBooking, cars).length}\nRoutes: ${Array.from(new Set(getBookingItems(quotationBooking, cars).map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}\nDates: ${computeBookingDateSummary(getBookingItems(quotationBooking, cars)).map(toISODateString).join(", ")}\nSubtotal: ${currencyGH(vat.subtotal)}\nDiscount: ${currencyGH(vat.discount)}\nTaxable Amount: ${currencyGH(vat.taxableAmount)}\nVAT @ 15%: ${currencyGH(vat.vat)}\nNHIL @ 2.5%: ${currencyGH(vat.nhil)}\nGETFund @ 2.5%: ${currencyGH(vat.getfund)}\nGrand Total: ${currencyGH(vat.grandTotal)}\n\n${quotationNotes || companyProfile.quotationTerms || ""}` });
    setQuotationOpen(false);
  };
  const saveInvoiceToAudit = async () => {
    if (!invoiceBooking) return;
    const totals = getBookingTotals(invoiceBooking, cars);
    const vat = computeGhanaVatSummary(totals.totalGrossClientAmount, totals.totalDiscountAmount, companyProfile.vatEnabled);
    await addDoc(collection(db, "audit"), { action: `Invoice generated (${invoiceNumber}) for ${invoiceBooking.customer} — Vehicles ${getBookingItems(invoiceBooking, cars).length} — Total ${currencyGH(vat.grandTotal)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), invoiceNumber, bookingId: invoiceBooking.id, documentType: "invoice", vatSummary: vat });
    await sendEmailNotification({ toEmail: invoiceBooking.customerEmail, bookingId: invoiceBooking.id, actionType: "invoice_generated", subject: `Invoice ${invoiceNumber} - ${invoiceBooking.customer || "Customer"}`, message: `${companyProfile.companyName || "MAALVILA Car Rental Services"}\nINVOICE\nInvoice No: ${invoiceNumber}\nCustomer: ${invoiceBooking.customer || ""}\nVehicles: ${getBookingItems(invoiceBooking, cars).length}\nSubtotal: ${currencyGH(vat.subtotal)}\nDiscount: ${currencyGH(vat.discount)}\nVAT @ 15%: ${currencyGH(vat.vat)}\nNHIL @ 2.5%: ${currencyGH(vat.nhil)}\nGETFund @ 2.5%: ${currencyGH(vat.getfund)}\nGrand Total: ${currencyGH(vat.grandTotal)}\n\n${invoiceNotes || companyProfile.invoiceFooter || ""}` });
    setInvoiceOpen(false);
  };
  const saveSupplierStatementToAudit = async () => {
    if (!supplierStatementBooking || !supplierStatementSourceId) return;
    const source = sources.find((s) => s.id === supplierStatementSourceId);
    const items = getBookingItems(supplierStatementBooking, cars).filter((i) => i.sourceId === supplierStatementSourceId);
    const totals = computePricingTotals(items);
    await addDoc(collection(db, "audit"), { action: `Supplier statement generated (${supplierStatementNumber}) for ${source?.sourceName || "Supplier"} — Net payable ${currencyGH(totals.totalNetSupplierPayable)}`, userId: user?.email || roleEmail || "", uid: user?.uid || "", time: serverTimestamp(), supplierStatementNumber, bookingId: supplierStatementBooking.id, sourceId: supplierStatementSourceId, documentType: "supplier_statement", supplierTotals: totals });
    alert("Supplier statement saved to Audit Trail.");
  };
  const openPayment = (b) => { if (!can(role, "recordPayment")) return alert("Only Admin/Staff can record payments."); setPaymentBooking(b); setPaymentAmount(""); setPaymentMethod("cash"); setPaymentReference(""); setPaymentNote(""); setPaymentOpen(true); };
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
    const vat = computeGhanaVatSummary(totals.totalGrossClientAmount, totals.totalDiscountAmount, companyProfile.vatEnabled);
    return <div className="border rounded-xl p-4 bg-white space-y-3">{renderBrandHeader()}<div className="border-t pt-3"><div className="text-sm text-gray-600">{type}</div><div className="text-lg font-bold">{number}</div></div><div className="grid md:grid-cols-2 gap-2 text-sm"><div>Customer: <b>{booking.customer}</b></div><div>Email: <b>{booking.customerEmail || "—"}</b></div><div className="md:col-span-2">Routes Summary: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="md:col-span-2">Booking Dates Summary: <b>{computeBookingDateSummary(items).map(toISODateString).join(", ")}</b></div></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Car No.</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2 text-right">Days</th><th className="p-2 text-right">Daily Rate</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Discount</th><th className="p-2 text-right">Net</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2">{i.carName}</td><td className="p-2">{i.carNumber}</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2 text-right">{i.days}</td><td className="p-2 text-right">{currencyGH(i.clientDailyRate)}</td><td className="p-2 text-right">{currencyGH(i.grossClientAmount)}</td><td className="p-2 text-right">{currencyGH(i.discountAmount)}</td><td className="p-2 text-right font-medium">{currencyGH(i.netClientAmount)}</td></tr>)}</tbody></table></div><div className="border-t pt-3 text-sm space-y-1">{[["Subtotal", vat.subtotal], ["Discount", vat.discount], ["Taxable Amount", vat.taxableAmount], ["VAT @ 15%", vat.vat], ["NHIL @ 2.5%", vat.nhil], ["GETFund @ 2.5%", vat.getfund]].map(([label, val]) => <div key={label} className="flex justify-between"><span>{label}</span><b>{currencyGH(val)}</b></div>)}<div className="flex justify-between border-t pt-2 text-base"><span>Grand Total</span><b>{currencyGH(vat.grandTotal)}</b></div></div>{notes ? <div className="text-xs text-gray-600 border-t pt-2">{notes}</div> : null}</div>;
  };
  const SupplierStatementPreview = ({ booking, sourceId, number }) => {
    const source = sources.find((s) => s.id === sourceId);
    const items = getBookingItems(booking, cars).filter((i) => i.sourceId === sourceId);
    const totals = computePricingTotals(items);
    return <div className="border rounded-xl p-4 bg-white space-y-3">{renderBrandHeader()}<div className="border-t pt-3"><div className="text-sm text-gray-600">Supplier Statement</div><div className="text-lg font-bold">{number}</div></div><div className="grid md:grid-cols-2 gap-2 text-sm"><div>Supplier: <b>{source?.sourceName || "—"}</b></div><div>Type: <b>{sourceTypeLabel(source?.sourceType)}</b></div><div>Client: <b>{booking.customer}</b></div><div>Routes: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="md:col-span-2">Booking Dates Summary: <b>{computeBookingDateSummary(items).map(toISODateString).join(", ")}</b></div></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Car No.</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2 text-right">Days</th><th className="p-2 text-right">Supplier Rate</th><th className="p-2 text-right">Gross Supplier</th><th className="p-2 text-right">Discount Share</th><th className="p-2 text-right">Net Payable</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2">{i.carName}</td><td className="p-2">{i.carNumber}</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2 text-right">{i.days}</td><td className="p-2 text-right">{currencyGH(i.supplierRate)}</td><td className="p-2 text-right">{currencyGH(i.grossSupplierAmount)}</td><td className="p-2 text-right">{currencyGH(i.supplierDiscountShare)}</td><td className="p-2 text-right font-medium">{currencyGH(i.netSupplierPayable)}</td></tr>)}</tbody></table></div><div className="border-t pt-3 text-sm space-y-1"><div className="flex justify-between"><span>Gross Supplier Amount</span><b>{currencyGH(totals.totalGrossSupplierAmount)}</b></div><div className="flex justify-between"><span>Supplier Discount Share</span><b>{currencyGH(totals.totalSupplierDiscountShare)}</b></div><div className="flex justify-between border-t pt-2 text-base"><span>Net Supplier Payable</span><b>{currencyGH(totals.totalNetSupplierPayable)}</b></div></div></div>;
  };

  return <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto bg-slate-50 min-h-screen">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold">Rental Dashboard - Phase 3B.1</motion.h1><div className="flex items-center gap-2"><div className="text-sm text-gray-700">Signed in: <b>{roleEmail || user.email || "unknown"}</b> • Role: <b className="uppercase">{role}</b></div><Button variant="outline" className="gap-2" onClick={logout}><LogOut className="w-4 h-4" /> Logout</Button></div></div>
    <Card className="rounded-2xl border bg-white"><CardContent className="p-3"><div className="flex flex-wrap gap-2">{[{ key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> }, { key: "bookings", label: "Bookings", icon: <ClipboardList className="w-4 h-4" /> }, { key: "cars", label: "Cars & Sources", icon: <Car className="w-4 h-4" /> }, { key: "documents", label: "Documents", icon: <ReceiptText className="w-4 h-4" /> }, { key: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> }, { key: "audit", label: "Audit Trail", icon: <FileText className="w-4 h-4" /> }].map((tab) => <Button key={tab.key} variant={activeView === tab.key ? "default" : "outline"} className="gap-2" onClick={() => setActiveView(tab.key)}>{tab.icon}{tab.label}</Button>)}</div></CardContent></Card>

    {activeView === "overview" && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{kpiCards.map((k) => <Card key={k.label} className={`rounded-2xl border ${k.bg}`}><CardContent className="p-4 flex items-center gap-3"><div className="p-2 rounded-xl bg-white/80">{k.icon}</div><div><div className="text-xs text-gray-600">{k.label}</div><div className="text-xl font-bold">{k.value}</div></div></CardContent></Card>)}</div><div className="grid lg:grid-cols-2 gap-4"><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Top Cars (Vehicle Lines)</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={topCarsBarData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" hide /><YAxis /><ReTooltip formatter={(v) => [`${v}`, "Vehicle lines"]} /><Bar dataKey="count">{topCarsBarData.map((r) => <Cell key={r.carNo} fill={hashColor(r.carNo)} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Booking Status</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><PieChart><ReTooltip /><Legend /><Pie data={statusPieData} dataKey="value" nameKey="name" outerRadius={90} label>{statusPieData.map((s) => <Cell key={s.name} fill={hashColor(s.name)} />)}</Pie></PieChart></ResponsiveContainer></div></CardContent></Card></div><div className="grid lg:grid-cols-2 gap-4"><Card className="rounded-2xl"><CardContent className="p-4"><div className="flex justify-between gap-2"><h2 className="font-semibold text-lg">Client Net Revenue Trend</h2><select className="border rounded-lg p-2 text-sm" value={trendMode} onChange={(e) => setTrendMode(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><LineChart data={revenueTrendData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><ReTooltip formatter={(v) => [currencyGH(v), "Revenue"]} /><Line type="monotone" dataKey="revenue" stroke={hashColor("revenue")} strokeWidth={3} dot /></LineChart></ResponsiveContainer></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="font-semibold text-lg">Utilization (Last 90 Days)</h2><div className="h-64 mt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={utilizationTopCars}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" hide /><YAxis /><ReTooltip formatter={(v) => [`${v}`, "Booked days"]} /><Bar dataKey="bookedDays">{utilizationTopCars.map((r) => <Cell key={r.carNo} fill={hashColor("util-" + r.carNo)} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card></div><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Top Customers (Confirmed Client Net Revenue)</h2><table className="w-full text-sm"><tbody>{topCustomers.map((c) => <tr key={c.customerName} className="border-b"><td className="py-2 font-medium">{c.customerName}</td><td className="py-2 text-right">{currencyGH(c.total)}</td></tr>)}{!topCustomers.length && <tr><td className="py-3 text-gray-500">No confirmed bookings yet.</td></tr>}</tbody></table></CardContent></Card></>}

    {activeView === "cars" && <><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><h2 className="text-lg font-semibold">Add Source / Supplier</h2>{can(role, "addSource") ? <><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Source Name" value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={newSourceType} onChange={(e) => setNewSourceType(e.target.value)}><option value="main">Main / MAALVILA</option><option value="rental_company">Attached Rental Company</option><option value="individual">Individual / Other</option></select><Input placeholder="Contact Person" value={newSourceContactPerson} onChange={(e) => setNewSourceContactPerson(e.target.value)} /><Input placeholder="Phone" value={newSourcePhone} onChange={(e) => setNewSourcePhone(e.target.value)} /><Input placeholder="Email" value={newSourceEmail} onChange={(e) => setNewSourceEmail(e.target.value)} /><Input placeholder="Address" value={newSourceAddress} onChange={(e) => setNewSourceAddress(e.target.value)} /></div><Button onClick={addSource}>Add Source</Button></> : <div className="text-sm text-gray-500">Only Admin can add sources.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><h2 className="text-lg font-semibold">Add Car</h2>{can(role, "addCar") ? <><div className="grid md:grid-cols-4 gap-2"><Input placeholder="Car Name" value={newCarName} onChange={(e) => setNewCarName(e.target.value)} /><Input placeholder="Car Number" value={newCarNumber} onChange={(e) => setNewCarNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={newCarSourceId} onChange={(e) => setNewCarSourceId(e.target.value)}><option value="">Select Source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.sourceName} — {sourceTypeLabel(s.sourceType)}</option>)}</select><Button onClick={addCar}>Add Car</Button></div></> : <div className="text-sm text-gray-500">Only Admin can add cars.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Sources / Suppliers</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-600 border-b"><th className="py-2 pr-4">Source</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Cars</th><th className="py-2 pr-4">Bookings</th><th className="py-2 pr-4">Vehicle Lines</th><th className="py-2 pr-4">Supplier Payable</th><th className="py-2 pr-4">Admin Income</th></tr></thead><tbody>{sourceSummary.map((s) => <tr key={s.sourceId} className="border-b"><td className="py-2 pr-4 font-medium">{s.sourceName}</td><td className="py-2 pr-4"><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${sourceBadgeClass(s.sourceType)}`}>{sourceTypeLabel(s.sourceType)}</span></td><td>{s.cars}</td><td>{s.bookings}</td><td>{s.vehicleLines}</td><td>{currencyGH(s.netSupplierPayable)}</td><td>{currencyGH(s.adminIncome)}</td></tr>)}{!sourceSummary.length && <tr><td colSpan={7} className="py-3 text-gray-500">No sources added yet.</td></tr>}</tbody></table></div></CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Cars List</h2><table className="w-full text-sm"><tbody>{cars.map((c) => <tr key={c.id} className="border-b"><td className="py-2 font-medium">{c.name}</td><td>{c.number}</td><td>{c.sourceName || "Not assigned"}</td><td>{sourceTypeLabel(c.sourceType)}</td></tr>)}{!cars.length && <tr><td className="py-3 text-gray-500">No cars added yet.</td></tr>}</tbody></table></CardContent></Card></>}

    {activeView === "bookings" && <><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{editBookingId ? "Edit Multi-Car Booking" : "New Multi-Car Booking"}</h2><div className="text-xs text-gray-500">One client booking can now include multiple cars.</div></div>{can(role, "addBooking") ? <><div className="grid md:grid-cols-4 gap-2 items-start"><Input placeholder="Customer Name" value={customer} onChange={(e) => setCustomer(e.target.value)} /><Input placeholder="Customer Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} /><Input placeholder="Customer Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}><option value="email">Email</option><option value="whatsapp" disabled>WhatsApp later</option><option value="sms" disabled>SMS later</option></select></div><div className="text-sm p-2 rounded-lg bg-white border">Client Net Preview: <b>{currencyGH(formTotals.totalNetClientAmount)}</b></div><div className="text-sm p-2 rounded-lg bg-amber-50 border border-amber-200">Enter route, driver, and trip days inside each vehicle line. Different cars can share the same dates or have different routes/dates.</div><div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Vehicle Line Items</h3><Button type="button" variant="outline" onClick={addBookingItem} className="gap-2"><Plus className="w-4 h-4" /> Add Car Line</Button></div>{bookingItems.map((item, idx) => { const computed = formItemsComputed.find((x) => x.itemId === item.itemId) || computeItemSplit(item, [], cars); return <Card key={item.itemId} className="rounded-xl border bg-white"><CardContent className="p-3 space-y-3"><div className="flex items-center justify-between"><div className="font-semibold text-sm">Vehicle Line {idx + 1}</div>{bookingItems.length > 1 && <Button variant="outline" size="sm" className="gap-2" onClick={() => removeBookingItem(item.itemId)}><Trash2 className="w-4 h-4" /> Remove</Button>}</div><div className="grid md:grid-cols-5 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={item.carNumber} onChange={(e) => { const c = cars.find((x) => String(x.number) === String(e.target.value)); const defaultSupplierPct = c?.sourceType === "main" ? 0 : 50; const defaultAdminPct = c?.sourceType === "main" ? 100 : 50; updateBookingItem(item.itemId, { carNumber: e.target.value, supplierDiscountSharePct: defaultSupplierPct, adminDiscountSharePct: defaultAdminPct }); }}><option value="">Select Car</option>{cars.map((c) => <option key={c.id} value={c.number}>{c.name} ({c.number}) — {c.sourceName || "No source"}</option>)}</select><Input placeholder="Travel From for this car" value={item.travelFrom || ""} onChange={(e) => updateBookingItem(item.itemId, { travelFrom: e.target.value })} /><Input placeholder="Travel To for this car" value={item.travelTo || ""} onChange={(e) => updateBookingItem(item.itemId, { travelTo: e.target.value })} /><Input placeholder="Driver for this car" value={item.driver || ""} onChange={(e) => updateBookingItem(item.itemId, { driver: e.target.value })} /><Input placeholder="Driver Contact" value={item.driverPhone || ""} onChange={(e) => updateBookingItem(item.itemId, { driverPhone: e.target.value })} /></div><div className="grid md:grid-cols-3 gap-2"><Input type="number" placeholder="Supplier Rate (GHS)" value={item.supplierRate} onChange={(e) => updateBookingItem(item.itemId, { supplierRate: e.target.value })} /><Input type="number" placeholder="MAALVILA Admin Charge (GHS)" value={item.adminCharge} onChange={(e) => updateBookingItem(item.itemId, { adminCharge: e.target.value })} /><div className="text-sm p-2 border rounded-lg bg-slate-50">Client Daily: <b>{currencyGH(computed.clientDailyRate)}</b></div></div><div className="grid md:grid-cols-5 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={item.discountType} onChange={(e) => updateBookingItem(item.itemId, { discountType: e.target.value, discountValue: e.target.value === "none" ? "" : item.discountValue })}><option value="none">No Discount</option><option value="fixed">Fixed Amount (GHS)</option><option value="percentage">Percentage of Client Gross (%)</option></select><Input type="number" placeholder={item.discountType === "fixed" ? "Discount Amount (GHS), e.g. 120" : item.discountType === "percentage" ? "Discount Rate %, e.g. 5" : "No Discount"} value={item.discountValue} disabled={item.discountType === "none"} onChange={(e) => updateBookingItem(item.itemId, { discountValue: e.target.value })} /><Input type="number" placeholder="Supplier Share %" value={item.supplierDiscountSharePct} onChange={(e) => updateBookingItem(item.itemId, { supplierDiscountSharePct: e.target.value })} /><Input type="number" placeholder="MAALVILA Share %" value={item.adminDiscountSharePct} onChange={(e) => updateBookingItem(item.itemId, { adminDiscountSharePct: e.target.value })} /><div className="text-xs p-2 border rounded-lg bg-slate-50">Shares: {Number(item.supplierDiscountSharePct || 0) + Number(item.adminDiscountSharePct || 0)}%</div></div><div className="border rounded-xl p-2 bg-white"><div className="text-sm font-medium flex items-center gap-2 mb-2"><CalendarDays className="w-4 h-4" />Trip Days for this car line</div><div className="inline-block border rounded-xl p-2 bg-white"><Calendar mode="multiple" selected={normalizeSelectedDates(item.selectedDates)} onSelect={(dates) => updateBookingItem(item.itemId, { selectedDates: normalizeSelectedDates(dates) })} className="rounded-lg" /></div><div className="text-xs text-gray-500 mt-2">Selected: {normalizeSelectedDates(item.selectedDates).map(toISODateString).join(", ") || "None"}</div></div><div className="grid md:grid-cols-3 gap-2 text-xs text-gray-700"><div className="p-2 rounded-lg bg-blue-50 border">Client Gross: <b>{currencyGH(computed.grossClientAmount)}</b><br />Discount: <b>{currencyGH(computed.discountAmount)}</b><br />Client Net: <b>{currencyGH(computed.netClientAmount)}</b></div><div className="p-2 rounded-lg bg-rose-50 border">Supplier Gross: <b>{currencyGH(computed.grossSupplierAmount)}</b><br />Discount Share: <b>{currencyGH(computed.supplierDiscountShare)}</b><br />Payable: <b>{currencyGH(computed.netSupplierPayable)}</b></div><div className="p-2 rounded-lg bg-emerald-50 border">Admin Gross: <b>{currencyGH(computed.grossAdminAmount)}</b><br />Discount Share: <b>{currencyGH(computed.adminDiscountShare)}</b><br />Admin Income: <b>{currencyGH(computed.netAdminIncome)}</b></div></div></CardContent></Card>; })}</div><Card className="rounded-xl bg-slate-900 text-white"><CardContent className="p-3 grid md:grid-cols-4 gap-2 text-sm"><div>Client Gross: <b>{currencyGH(formTotals.totalGrossClientAmount)}</b></div><div>Total Discount: <b>{currencyGH(formTotals.totalDiscountAmount)}</b></div><div>Client Net: <b>{currencyGH(formTotals.totalNetClientAmount)}</b></div><div>Supplier Payable: <b>{currencyGH(formTotals.totalNetSupplierPayable)}</b></div><div>Admin Income: <b>{currencyGH(formTotals.totalNetAdminIncome)}</b></div></CardContent></Card><div className="flex flex-wrap gap-2"><Button onClick={saveBooking}>{editBookingId ? "Update Booking" : "Save Multi-Car Booking"}</Button>{editBookingId && <Button variant="outline" onClick={resetBookingForm}>Cancel Edit</Button>}</div></> : <div className="text-sm text-gray-500">You do not have permission to add bookings.</div>}</CardContent></Card><Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><h2 className="text-lg font-semibold">Filter / Export</h2><div className="text-xs text-gray-500">Showing <b>{filteredBookings.length}</b> / {bookings.length} bookings</div></div><div className="grid md:grid-cols-7 gap-2"><select className="border rounded-lg p-2 text-sm h-10" value={filterCar} onChange={(e) => setFilterCar(e.target.value)}><option value="">All Cars</option>{cars.map((c) => <option key={c.id} value={c.number}>{c.name} ({c.number})</option>)}</select><select className="border rounded-lg p-2 text-sm h-10" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}><option value="">All Sources</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.sourceName} — {sourceTypeLabel(s.sourceType)}</option>)}</select><select className="border rounded-lg p-2 text-sm h-10" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="">All Statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select><Input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /><Input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /><Button onClick={exportCSV} disabled={!can(role, "export")}>Export CSV</Button><Button onClick={() => window.print()} variant="outline" disabled={!can(role, "export")}>Print</Button></div></CardContent></Card><Card className="rounded-2xl"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Bookings</h2><div className="space-y-3">{filteredBookings.map((b) => { const items = getBookingItems(b, cars); const totals = getBookingTotals(b, cars); const total = computeBookingTotalAmount(b, cars); const paid = clampMoney(b.amountPaid || 0); const balance = Math.max(0, total - paid); const payStatus = b.paymentStatus || computePaymentStatus(total, paid); const statusClass = b.status === "confirmed" ? "text-green-700 bg-green-50 border-green-200" : b.status === "pending" ? "text-yellow-800 bg-yellow-50 border-yellow-200" : "text-red-700 bg-red-50 border-red-200"; const payClass = payStatus === "paid" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : payStatus === "partial" ? "text-violet-800 bg-violet-50 border-violet-200" : "text-slate-700 bg-slate-50 border-slate-200"; const supplierSources = Array.from(new Set(items.map((i) => i.sourceId).filter(Boolean))); return <div key={b.id} className="border rounded-2xl p-3 bg-white hover:shadow-sm transition"><div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2"><div className="space-y-2 flex-1"><div className="font-semibold text-lg">{b.customer}</div><div className="text-sm text-gray-700">Routes Summary: <b>{Array.from(new Set(items.map((i) => `${i.travelFrom || "—"} → ${i.travelTo || "—"}`))).join(" | ")}</b></div><div className="text-sm text-gray-700">Contact: <b>{b.customerEmail || "—"}</b>{b.customerPhone ? <span> • {b.customerPhone}</span> : null}</div><div className="text-sm text-gray-700">Booking Dates Summary: <span className="font-medium">{computeBookingDateSummary(items).map(toISODateString).join(", ")}</span></div><div className="overflow-auto"><table className="w-full text-xs border"><thead><tr className="bg-slate-50 text-left"><th className="p-2">Car</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Dates</th><th className="p-2">Source</th><th className="p-2 text-right">Supplier Payable</th><th className="p-2 text-right">Admin Income</th><th className="p-2 text-right">Client Net</th></tr></thead><tbody>{items.map((i) => <tr key={i.itemId} className="border-t"><td className="p-2"><b>{i.carName}</b> ({i.carNumber})</td><td className="p-2">{i.travelFrom || "—"} → {i.travelTo || "—"}</td><td className="p-2">{i.driver || "—"}{i.driverPhone ? ` (${i.driverPhone})` : ""}</td><td className="p-2">{normalizeSelectedDates(i.selectedDates).map(toISODateString).join(", ")}</td><td className="p-2">{i.sourceName || "—"}</td><td className="p-2 text-right">{currencyGH(i.netSupplierPayable)}</td><td className="p-2 text-right">{currencyGH(i.netAdminIncome)}</td><td className="p-2 text-right font-medium">{currencyGH(i.netClientAmount)}</td></tr>)}</tbody></table></div><div className="flex flex-wrap gap-2 text-sm"><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${statusClass}`}>Status: {b.status || "pending"}</span><span className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${payClass}`}>Payment: {payStatus}</span><span className="inline-flex items-center px-2 py-1 border rounded-xl text-xs bg-slate-50">Vehicle Lines: {items.length}</span></div><div className="grid md:grid-cols-3 gap-2 text-xs"><div className="p-2 rounded-lg bg-blue-50 border">Client Gross: <b>{currencyGH(totals.totalGrossClientAmount)}</b><br />Discount: <b>{currencyGH(totals.totalDiscountAmount)}</b><br />Client Net: <b>{currencyGH(totals.totalNetClientAmount)}</b></div><div className="p-2 rounded-lg bg-rose-50 border">Supplier Payable: <b>{currencyGH(totals.totalNetSupplierPayable)}</b></div><div className="p-2 rounded-lg bg-emerald-50 border">Admin Income: <b>{currencyGH(totals.totalNetAdminIncome)}</b><br />Paid: <b>{currencyGH(paid)}</b><br />Balance: <b>{currencyGH(balance)}</b></div></div></div><div className="flex flex-wrap gap-2 md:justify-end">{can(role, "confirmBooking") && b.status === "pending" && <Button onClick={() => confirmBooking(b)}>Confirm</Button>}{can(role, "cancelBooking") && b.status !== "cancelled" && <Button variant="destructive" onClick={() => cancelBooking(b)}>Cancel</Button>}{can(role, "editBooking") && <Button variant="outline" onClick={() => editBooking(b)}>Edit</Button>}{can(role, "recordPayment") && <Button variant="outline" onClick={() => openPayment(b)}>Record Payment</Button>}<Button variant="outline" className="gap-2" onClick={() => openQuotation(b)}><ScrollText className="w-4 h-4" /> Quote</Button><Button variant="outline" className="gap-2" onClick={() => openInvoice(b)}><FileText className="w-4 h-4" /> Invoice</Button>{supplierSources.length > 0 && <Button variant="outline" className="gap-2" onClick={() => openSupplierStatement(b)}><UsersRound className="w-4 h-4" /> Supplier Statement</Button>}</div></div></div>; })}{!filteredBookings.length && <div className="text-sm text-gray-500">No bookings match your filter.</div>}</div></CardContent></Card>{paymentOpen && paymentBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Record Payment</h2><Button variant="outline" onClick={() => setPaymentOpen(false)}>Close</Button></div><div className="text-sm text-gray-700">Booking: <b>{paymentBooking.customer}</b> • Client Net: <b>{currencyGH(computeBookingTotalAmount(paymentBooking, cars))}</b></div><div className="grid md:grid-cols-5 gap-2"><Input type="number" placeholder="Amount (GH₵)" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="card">Card</option></select><Input placeholder="Reference" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /><Input placeholder="Note" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} /><Button onClick={recordPayment}>Save Payment</Button></div><div><h3 className="font-semibold text-sm mb-2">Payment History</h3>{paymentHistory.map((p) => <div key={p.id} className="text-sm border rounded-xl p-2 bg-white mb-2"><div className="font-medium">{currencyGH(p.amount)} • {p.method || "cash"}{p.reference ? ` • Ref: ${p.reference}` : ""}</div>{p.note ? <div className="text-xs text-gray-600">{p.note}</div> : null}<div className="text-xs text-gray-500">{safeTimeToLocaleString(p.paidAt)} • by {p.recordedByEmail || "unknown"}</div></div>)}{!paymentHistory.length && <div className="text-sm text-gray-500">No payments recorded yet.</div>}</div></CardContent></Card>}</>}

    {activeView === "documents" && <>{!quotationOpen && !invoiceOpen && !supplierStatementOpen && <Card className="rounded-2xl shadow"><CardContent className="p-4 text-sm text-gray-600">Open the <b>Bookings</b> tab and click <b>Quote</b>, <b>Invoice</b>, or <b>Supplier Statement</b> on a booking to generate a document.</CardContent></Card>}{quotationOpen && quotationBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Quotation Generator</h2><Button variant="outline" onClick={() => setQuotationOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Quotation Number" value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} /><Input placeholder="Quotation notes / terms" value={quotationNotes} onChange={(e) => setQuotationNotes(e.target.value)} /><Button onClick={saveQuotationToAudit}>Save + Email Quote</Button></div><ClientDocumentPreview type="Quotation" number={quotationNumber} booking={quotationBooking} notes={quotationNotes} /></CardContent></Card>}{invoiceOpen && invoiceBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Invoice Generator</h2><Button variant="outline" onClick={() => setInvoiceOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Invoice Number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /><Input placeholder="Notes / footer" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} /><Button onClick={saveInvoiceToAudit}>Save + Email Invoice</Button></div><ClientDocumentPreview type="Invoice" number={invoiceNumber} booking={invoiceBooking} notes={invoiceNotes} /></CardContent></Card>}{supplierStatementOpen && supplierStatementBooking && <Card className="rounded-2xl border-2"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Supplier Statement Generator</h2><Button variant="outline" onClick={() => setSupplierStatementOpen(false)}>Close</Button></div><div className="grid md:grid-cols-3 gap-2"><Input placeholder="Statement Number" value={supplierStatementNumber} onChange={(e) => setSupplierStatementNumber(e.target.value)} /><select className="border rounded-lg p-2 text-sm h-10" value={supplierStatementSourceId} onChange={(e) => setSupplierStatementSourceId(e.target.value)}>{Array.from(new Set(getBookingItems(supplierStatementBooking, cars).map((i) => i.sourceId).filter(Boolean))).map((sid) => { const s = sources.find((x) => x.id === sid); return <option key={sid} value={sid}>{s?.sourceName || sid}</option>; })}</select><Button onClick={saveSupplierStatementToAudit}>Save Supplier Statement</Button></div><SupplierStatementPreview booking={supplierStatementBooking} sourceId={supplierStatementSourceId} number={supplierStatementNumber} /></CardContent></Card>}</>}

    {activeView === "settings" && <Card className="rounded-2xl shadow"><CardContent className="p-4 space-y-4"><div className="flex items-center gap-2"><Building2 className="w-5 h-5" /><h2 className="text-lg font-semibold">Company Profile & Document Settings</h2></div><div className="grid md:grid-cols-2 gap-3">{[["Company Name", "companyName"], ["Company Email", "companyEmail"], ["Company Phone", "companyPhone"], ["Company Address", "companyAddress"], ["TIN", "companyTin"], ["VAT Registration Number", "vatNumber"], ["Logo URL e.g. /maalvila-Logo.jpg.png", "logoUrl"], ["Letterhead URL e.g. /MAALVILA-letterhead.jpg.png", "letterheadUrl"]].map(([ph, key]) => <Input key={key} placeholder={ph} value={companyProfile[key] || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, [key]: e.target.value }))} />)}<select className="border rounded-lg p-2 text-sm h-10" value={companyProfile.vatEnabled ? "yes" : "no"} onChange={(e) => setCompanyProfile((p) => ({ ...p, vatEnabled: e.target.value === "yes" }))}><option value="yes">VAT Enabled</option><option value="no">VAT Disabled</option></select><select className="border rounded-lg p-2 text-sm h-10" value={companyProfile.vatMode || "exclusive"} onChange={(e) => setCompanyProfile((p) => ({ ...p, vatMode: e.target.value }))}><option value="exclusive">VAT Exclusive Pricing</option><option value="inclusive">VAT Inclusive Pricing (later)</option></select></div><div className="grid gap-3"><Input placeholder="Quotation Terms" value={companyProfile.quotationTerms || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, quotationTerms: e.target.value }))} /><Input placeholder="Invoice Footer" value={companyProfile.invoiceFooter || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, invoiceFooter: e.target.value }))} /><Input placeholder="Receipt Footer" value={companyProfile.receiptFooter || ""} onChange={(e) => setCompanyProfile((p) => ({ ...p, receiptFooter: e.target.value }))} /></div><div className="rounded-xl border bg-white p-3 text-sm text-gray-600">Ghana VAT-ready format: VAT 15%, NHIL 2.5%, GETFund 2.5%.</div><Button onClick={saveCompanyProfile} disabled={savingProfile || !can(role, "settings")}>{savingProfile ? "Saving..." : "Save Company Settings"}</Button></CardContent></Card>}

    {activeView === "audit" && <Card className="rounded-2xl"><CardContent className="p-4"><h2 className="text-lg font-semibold mb-3">Audit Trail</h2><div className="space-y-2">{audit.map((a) => <div key={a.id} className="text-sm border-b py-2"><div className="font-medium">{a.action}</div><div className="text-xs text-gray-500">User: <b>{a.userId || a.createdByEmail || roleEmail || user.email || "unknown"}</b> {a.uid ? <span>• UID: {a.uid}</span> : null} • {safeTimeToLocaleString(a.time) || "—"}{a.invoiceNumber ? <span> • Invoice: {a.invoiceNumber}</span> : null}{a.quotationNumber ? <span> • Quote: {a.quotationNumber}</span> : null}{a.supplierStatementNumber ? <span> • Supplier Statement: {a.supplierStatementNumber}</span> : null}</div></div>)}{!audit.length && <div className="text-sm text-gray-500">No audit events yet.</div>}</div></CardContent></Card>}
  </div>;
}
