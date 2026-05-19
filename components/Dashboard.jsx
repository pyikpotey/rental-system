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
} from "lucide-react";

// ✅ Your existing firebase setup
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

/* ---------------------------- HELPERS ---------------------------- */

function isFirestoreTimestamp(x) {
  return (
    x &&
    typeof x === "object" &&
    typeof x.seconds === "number" &&
    typeof x.nanoseconds === "number"
  );
}

function toDateSafe(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (isFirestoreTimestamp(x)) return new Date(x.seconds * 1000);
  // Firestore Timestamp (v9) sometimes also has toDate()
  if (x && typeof x.toDate === "function") {
    const d = x.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof x === "string") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toISODateString(d) {
  if (!(d instanceof Date)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeSelectedDates(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const dates = arr
    .map((x) => toDateSafe(x))
    .filter(Boolean)
    .map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()));

  const seen = new Set();
  const deduped = [];
  for (const d of dates) {
    const key = toISODateString(d);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(d);
    }
  }
  deduped.sort((a, b) => a - b);
  return deduped;
}

function sameDay(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function currencyGH(amount) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
    }).format(n);
  } catch {
    return `GH₵ ${n.toFixed(2)}`;
  }
}

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

function getQuarterLabel(date) {
  const y = date.getFullYear();
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${y}`;
}

function getMonthLabel(date) {
  return format(date, "MMM yyyy");
}

function safeTimeToLocaleString(x) {
  const d = toDateSafe(x);
  if (!d) return "";
  try {
    return d.toLocaleString();
  } catch {
    return String(d);
  }
}

function clampMoney(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

function computeBookingTotalAmount(b) {
  const days = normalizeSelectedDates(b.selectedDates).length;
  const daily = Number(b.dailyRate || 0);
  const computed = daily * days;

  // Cancelled: if penalty exists, penalty becomes the payable amount
  if (b.status === "cancelled") {
    const pen = Number(b.penalty || 0);
    return pen > 0 ? pen : 0;
  }
  // Confirmed: use confirmedAmount if present, else computed
  if (b.status === "confirmed") {
    const ca = Number(b.confirmedAmount || 0);
    return ca > 0 ? ca : computed;
  }
  // Pending: show computed for reference
  return computed;
}

function computePaymentStatus(totalAmount, amountPaid) {
  const t = clampMoney(totalAmount);
  const p = clampMoney(amountPaid);
  if (t <= 0) return "unpaid";
  if (p <= 0) return "unpaid";
  if (p + 0.0001 < t) return "partial";
  return "paid";
}

/* ---------------------------- GHANA VAT / DOCUMENT HELPERS ---------------------------- */

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
  vatMode: "exclusive", // exclusive | inclusive
  quotationTerms:
    "This quotation is subject to vehicle availability, confirmation of booking, and agreed payment terms.",
  invoiceFooter: "Thank you for doing business with us.",
  receiptFooter: "Payment received with thanks.",
};

function generateDocNumber(prefix) {
  const d = new Date();
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${prefix}-${format(d, "yyyyMMdd")}-${rand}`;
}

function computeGhanaVatSummary(baseAmount, discountAmount = 0, vatEnabled = true) {
  const subtotal = clampMoney(baseAmount);
  const discount = Math.min(clampMoney(discountAmount), subtotal);
  const taxableAmount = Math.max(0, subtotal - discount);

  if (!vatEnabled) {
    return {
      subtotal,
      discount,
      taxableAmount,
      vat: 0,
      nhil: 0,
      getfund: 0,
      totalTax: 0,
      grandTotal: taxableAmount,
    };
  }

  const vat = taxableAmount * GHANA_VAT_RATE;
  const nhil = taxableAmount * GHANA_NHIL_RATE;
  const getfund = taxableAmount * GHANA_GETFUND_RATE;
  const totalTax = vat + nhil + getfund;
  const grandTotal = taxableAmount + totalTax;

  return {
    subtotal,
    discount,
    taxableAmount,
    vat,
    nhil,
    getfund,
    totalTax,
    grandTotal,
  };
}

function getBookingBaseAmount(b) {
  if (!b) return 0;
  const days = normalizeSelectedDates(b.selectedDates).length;
  const daily = Number(b.dailyRate || 0);
  return daily * days;
}

/* ---------------------------- PERMISSIONS ---------------------------- */

function can(role, action) {
  // Feature	            Admin	Staff	Viewer
  // Add Car	            ✅	    ❌	    ❌
  // Add Booking	        ✅	    ✅	    ❌
  // Edit Booking	        ✅	    ✅	    ❌
  // Confirm Booking	    ✅	    ❌	    ❌
  // Cancel Booking	    ✅	    ❌	    ❌
  // Record Payment      ✅      ✅      ❌
  // Export / Print	    ✅	    ✅	    ✅
  const r = role || "viewer";
  const map = {
    addCar: ["admin"],
    addBooking: ["admin", "staff"],
    editBooking: ["admin", "staff"],
    confirmBooking: ["admin"],
    cancelBooking: ["admin"],
    recordPayment: ["admin", "staff"],
    export: ["admin", "staff", "viewer"],
  };
  return (map[action] || []).includes(r);
}

/* ---------------------------- MAIN COMPONENT ---------------------------- */

export default function Dashboard() {
  /* ---------------------------- HOOKS (ALL AT TOP) ---------------------------- */

  const [user, setUser] = useState(null);
  const [role, setRole] = useState("viewer");
  const [roleEmail, setRoleEmail] = useState("");

  const [bookings, setBookings] = useState([]);
  const [cars, setCars] = useState([]);
  const [audit, setAudit] = useState([]);

  // Booking form states
  const [customer, setCustomer] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [travelFrom, setTravelFrom] = useState("");
  const [travelTo, setTravelTo] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("email");

  const [carNumber, setCarNumber] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [selectedDates, setSelectedDates] = useState([]);
  const [editBookingId, setEditBookingId] = useState(null);

  // Add car form states
  const [newCarName, setNewCarName] = useState("");
  const [newCarNumber, setNewCarNumber] = useState("");

  // Filter/export
  const [filterCar, setFilterCar] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // Invoice
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceBooking, setInvoiceBooking] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");

  // Analytics
  const [trendMode, setTrendMode] = useState("monthly"); // "monthly" | "quarterly"

  // Payments modal
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentHistory, setPaymentHistory] = useState([]);

  // UI
  const [loadingRole, setLoadingRole] = useState(true);

  // Tabs / views
  const [activeView, setActiveView] = useState("overview");

  // Company profile / document settings
  const [companyProfile, setCompanyProfile] = useState(DEFAULT_COMPANY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);

  // Quotation
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationBooking, setQuotationBooking] = useState(null);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [quotationNotes, setQuotationNotes] = useState("");
  const [quotationDiscountType, setQuotationDiscountType] = useState("none"); // none | fixed | percentage
  const [quotationDiscountValue, setQuotationDiscountValue] = useState("");

  /* ---------------------------- AUTH + ROLE ---------------------------- */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

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
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
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
      } catch {
        if (!cancelled) {
          setRole("viewer");
          setRoleEmail(user?.email || "");
        }
      } finally {
        if (!cancelled) setLoadingRole(false);
      }
    }

    fetchRole();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* ---------------------------- REALTIME DATA ---------------------------- */

  useEffect(() => {
    if (!user) return;

    const unsubBookings = onSnapshot(collection(db, "bookings"), (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        const normDates = normalizeSelectedDates(data.selectedDates);
        return {
          id: d.id,
          ...data,
          selectedDates: normDates,
          amountPaid: Number(data.amountPaid || 0),
          paymentStatus: data.paymentStatus || "unpaid",
        };
      });
      setBookings(rows);
    });

    const unsubCars = onSnapshot(collection(db, "cars"), (snap) => {
      setCars(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubAudit = onSnapshot(collection(db, "audit"), (snap) => {
      setAudit(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = toDateSafe(a.time)?.getTime?.() || 0;
            const tb = toDateSafe(b.time)?.getTime?.() || 0;
            return tb - ta;
          })
      );
    });

    return () => {
      unsubBookings();
      unsubCars();
      unsubAudit();
    };
  }, [user]);

  /* ---------------------------- COMPANY PROFILE ---------------------------- */

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "settings", "companyProfile");

    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setCompanyProfile({
          ...DEFAULT_COMPANY_PROFILE,
          ...(snap.data() || {}),
        });
      } else {
        setCompanyProfile(DEFAULT_COMPANY_PROFILE);
      }
    });

    return () => unsub();
  }, [user]);

  // Payments history subscription (only when modal is open)
  useEffect(() => {
    if (!paymentOpen || !paymentBooking?.id) {
      setPaymentHistory([]);
      return;
    }

    const qy = query(
      collection(db, "bookings", paymentBooking.id, "payments"),
      orderBy("paidAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPaymentHistory(rows);
    });

    return () => unsub();
  }, [paymentOpen, paymentBooking]);

  /* ---------------------------- DERIVED DATA ---------------------------- */

  const carsKPI = useMemo(() => {
    const set = new Set();
    cars.forEach((c) => c?.number && set.add(String(c.number)));
    bookings.forEach((b) => b?.carNumber && set.add(String(b.carNumber)));
    return set.size;
  }, [cars, bookings]);

  const revenue = useMemo(() => {
    return bookings.reduce((total, b) => {
      if (b.status === "confirmed") return total + Number(b.confirmedAmount || 0);
      return total;
    }, 0);
  }, [bookings]);

  const penaltyTotal = useMemo(() => {
    return bookings.reduce((total, b) => total + Number(b.penalty || 0), 0);
  }, [bookings]);

  const outstandingTotal = useMemo(() => {
    return bookings.reduce((sum, b) => {
      const totalAmt = computeBookingTotalAmount(b);
      const paid = clampMoney(b.amountPaid || 0);
      const bal = Math.max(0, clampMoney(totalAmt) - paid);
      return sum + bal;
    }, 0);
  }, [bookings]);

  const paidLast30Days = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);

    return bookings.reduce((sum, b) => {
      const t = toDateSafe(b.paymentUpdatedAt);
      if (!t) return sum;
      if (t < start) return sum;
      return sum + clampMoney(b.amountPaid || 0);
    }, 0);
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const start = filterStartDate ? new Date(filterStartDate) : null;
    const end = filterEndDate ? new Date(filterEndDate) : null;

    return bookings.filter((b) => {
      if (filterCar && String(b.carNumber) !== String(filterCar)) return false;
      if (filterStatus && String(b.status) !== String(filterStatus)) return false;

      if (start || end) {
        const s = start || new Date("2000-01-01");
        const e = end || new Date("2100-12-31");
        const has = (b.selectedDates || []).some((d) => d >= s && d <= e);
        if (!has) return false;
      }
      return true;
    });
  }, [bookings, filterCar, filterStatus, filterStartDate, filterEndDate]);

  const statusPieData = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const s = b.status || "pending";
      map.set(s, (map.get(s) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [bookings]);

  const topCarsBarData = useMemo(() => {
    const counts = {};
    bookings.forEach((b) => {
      const key = b.carNumber ? String(b.carNumber) : "(no car)";
      counts[key] = (counts[key] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([carNo, count]) => {
        const car = cars.find((c) => String(c.number) === String(carNo));
        const label = car ? `${car.name} (${carNo})` : carNo;
        return { carNo, label, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [bookings, cars]);

  /* ---------------------------- ADVANCED ANALYTICS (LAST 90 DAYS) ---------------------------- */

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

      const amt = Number(b.confirmedAmount || 0);
      if (!amt) continue;

      const dates = normalizeSelectedDates(b.selectedDates);
      const anchor =
        dates.find((d) => d >= last90Range.start && d <= last90Range.end) ||
        toDateSafe(b.createdAt) ||
        dates[0] ||
        null;
      if (!anchor) continue;
      if (anchor < last90Range.start || anchor > last90Range.end) continue;

      const key =
        trendMode === "quarterly" ? getQuarterLabel(anchor) : getMonthLabel(anchor);
      map.set(key, (map.get(key) || 0) + amt);
    }

    const keys = [];
    const cur = new Date(last90Range.start);
    cur.setHours(0, 0, 0, 0);

    const seen = new Set();
    while (cur <= last90Range.end) {
      const k =
        trendMode === "quarterly" ? getQuarterLabel(cur) : getMonthLabel(cur);
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
      cur.setMonth(cur.getMonth() + 1);
    }

    return keys.map((k) => ({ period: k, revenue: Number(map.get(k) || 0) }));
  }, [bookings, trendMode, last90Range]);

  const utilizationTopCars = useMemo(() => {
    const map = new Map();

    for (const b of bookings) {
      if (!b.carNumber) continue;
      if (b.status === "cancelled") continue;

      const carNo = String(b.carNumber);
      const set = map.get(carNo) || new Set();

      for (const d of normalizeSelectedDates(b.selectedDates)) {
        if (d < last90Range.start || d > last90Range.end) continue;
        set.add(toISODateString(d));
      }
      map.set(carNo, set);
    }

    const rows = Array.from(map.entries()).map(([carNo, set]) => {
      const car = cars.find((c) => String(c.number) === String(carNo));
      return {
        carNo,
        label: car ? `${car.name} (${carNo})` : carNo,
        bookedDays: set.size,
      };
    });

    return rows.sort((a, b) => b.bookedDays - a.bookedDays).slice(0, 10);
  }, [bookings, cars, last90Range]);

  // Top customers analytics (confirmed revenue)
  const topCustomers = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      if (b.status !== "confirmed") continue;
      const name = (b.customer || "(unknown)").trim();
      const amt = Number(b.confirmedAmount || 0);
      map.set(name, (map.get(name) || 0) + amt);
    }
    return Array.from(map.entries())
      .map(([customerName, total]) => ({ customerName, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [bookings]);

  /* ---------------------------- EMAIL NOTIFY ---------------------------- */
  // ✅ IMPORTANT: Your /api/notify route expects { to, subject, message }
  const sendEmailNotification = async ({
    toEmail,
    subject,
    message,
    bookingId,
    actionType,
    meta,
  }) => {
    if (!toEmail) return;

    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toEmail, // ✅ server expects "to"
          subject,
          message,
          bookingId: bookingId || "",
          actionType: actionType || "notify",
          userEmail: user?.email || roleEmail || "",
          meta: meta || {},
        }),
      });

      // If it fails, log it (helps in DevTools -> Network)
      if (!res.ok) {
        const text = await res.text();
        console.error("Notify failed:", res.status, text);
      }
    } catch (e) {
      console.error("Notify error:", e);
    }
  };

  /* ---------------------------- ACTIONS ---------------------------- */

  const logout = async () => {
    await signOut(auth);
  };

  const saveCompanyProfile = async () => {
    if (!can(role, "addCar")) {
      return alert("Only Admin can update company settings.");
    }

    setSavingProfile(true);
    try {
      await setDoc(doc(db, "settings", "companyProfile"), {
        ...companyProfile,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
        updatedByEmail: user?.email || roleEmail || "",
      });

      await addDoc(collection(db, "audit"), {
        action: `Company profile/settings updated`,
        userId: user?.email || roleEmail || "",
        uid: user?.uid || "",
        time: serverTimestamp(),
      });

      alert("Company profile saved successfully.");
    } catch (e) {
      console.error(e);
      alert("Could not save company profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const addCar = async () => {
    if (!can(role, "addCar")) return alert("Only Admin can add cars.");
    if (!newCarName || !newCarNumber) return alert("Fill car name and number.");

    const exists = cars.some((c) => String(c.number) === String(newCarNumber));
    if (exists) return alert("Duplicate car number is not allowed.");

    await addDoc(collection(db, "cars"), {
      name: newCarName.trim(),
      number: newCarNumber.trim(),
      createdAt: serverTimestamp(),
      createdBy: user?.uid || "",
      createdByEmail: user?.email || "",
    });

    await addDoc(collection(db, "audit"), {
      action: `Car added: ${newCarName} (${newCarNumber})`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
    });

    setNewCarName("");
    setNewCarNumber("");
  };

  const saveBooking = async () => {
    if (!can(role, "addBooking") && !can(role, "editBooking")) {
      return alert("You do not have permission to add/edit bookings.");
    }

    if (
      !customer ||
      !carNumber ||
      !driver ||
      !dailyRate ||
      !selectedDates.length
    ) {
      return alert("Fill all required fields and select dates.");
    }

    const normSelected = normalizeSelectedDates(selectedDates);

    const conflict = bookings.some((b) => {
      if (b.id === editBookingId) return false;
      if (String(b.carNumber) !== String(carNumber)) return false;
      if (b.status === "cancelled") return false;

      const existing = normalizeSelectedDates(b.selectedDates);
      return existing.some((ed) => normSelected.some((sd) => sameDay(ed, sd)));
    });

    if (conflict)
      return alert("Conflict: this car is already booked on some selected dates.");

    const carObj = cars.find((c) => String(c.number) === String(carNumber));
    const bookingData = {
      customer: customer.trim(),
      customerEmail: (customerEmail || "").trim(),
      customerPhone: (customerPhone || "").trim(),
      travelFrom: (travelFrom || "").trim(),
      travelTo: (travelTo || "").trim(),
      preferredChannel: preferredChannel || "email",

      carNumber: String(carNumber),
      carName: carObj?.name || "",
      driver: driver.trim(),
      driverPhone: (driverPhone || "").trim(),
      dailyRate: Number(dailyRate),
      selectedDates: normSelected,

      status: "pending",
      confirmedAmount: 0,
      penalty: 0,

      // payments
      amountPaid: 0,
      paymentStatus: "unpaid",

      createdBy: user?.uid || "",
      createdByEmail: user?.email || roleEmail || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (editBookingId) {
      await updateDoc(doc(db, "bookings", editBookingId), {
        ...bookingData,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "audit"), {
        action: `Booking updated for ${bookingData.customer} (${bookingData.carNumber}) — Days: ${normSelected.length}`,
        userId: user?.email || roleEmail || "",
        uid: user?.uid || "",
        time: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "bookings"), {
        ...bookingData,
      });
      await addDoc(collection(db, "audit"), {
        action: `New booking created for ${bookingData.customer} (${bookingData.carNumber}) — Days: ${normSelected.length}`,
        userId: user?.email || roleEmail || "",
        uid: user?.uid || "",
        time: serverTimestamp(),
      });
    }

    setCustomer("");
    setCustomerEmail("");
    setCustomerPhone("");
    setTravelFrom("");
    setTravelTo("");
    setPreferredChannel("email");

    setCarNumber("");
    setDriver("");
    setDriverPhone("");
    setDailyRate("");
    setSelectedDates([]);
    setEditBookingId(null);
  };

  const editBooking = (b) => {
    if (!can(role, "editBooking"))
      return alert("You do not have permission to edit bookings.");

    setCustomer(b.customer || "");
    setCustomerEmail(b.customerEmail || "");
    setCustomerPhone(b.customerPhone || "");
    setTravelFrom(b.travelFrom || "");
    setTravelTo(b.travelTo || "");
    setPreferredChannel(b.preferredChannel || "email");

    setCarNumber(String(b.carNumber || ""));
    setDriver(b.driver || "");
    setDriverPhone(b.driverPhone || "");
    setDailyRate(String(b.dailyRate ?? ""));
    setSelectedDates(normalizeSelectedDates(b.selectedDates));
    setEditBookingId(b.id);
  };

  const confirmBooking = async (b) => {
    if (!can(role, "confirmBooking"))
      return alert("Only Admin can confirm bookings.");

    const days = normalizeSelectedDates(b.selectedDates).length;
    const amt = Number(b.dailyRate || 0) * days;

    await updateDoc(doc(db, "bookings", b.id), {
      status: "confirmed",
      confirmedAmount: amt,
      penalty: 0,
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "audit"), {
      action: `Booking confirmed (${b.customer}) — Days: ${days} — Amount ${currencyGH(
        amt
      )}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
    });

    await sendEmailNotification({
      toEmail: b.customerEmail,
      bookingId: b.id,
      actionType: "booking_confirmed",
      subject: `Booking Confirmed - ${b.carName || ""} (${b.carNumber || ""})`,
      message:
        `Hello ${b.customer || "Customer"},\n\n` +
        `Your booking is CONFIRMED.\n\n` +
        `Car: ${b.carName || ""} (${b.carNumber || ""})\n` +
        `Driver: ${b.driver || ""}\n` +
        `Travel: ${(b.travelFrom || "")} → ${(b.travelTo || "")}\n` +
        `Dates: ${normalizeSelectedDates(b.selectedDates)
          .map(toISODateString)
          .join(", ")}\n` +
        `Daily Rate: ${currencyGH(b.dailyRate || 0)}\n` +
        `Total: ${currencyGH(amt)}\n\n` +
        `Thank you.`,
    });
  };

  const cancelBooking = async (b) => {
    if (!can(role, "cancelBooking"))
      return alert("Only Admin can cancel bookings.");

    const days = normalizeSelectedDates(b.selectedDates).length;
    const base = Number(b.dailyRate || 0) * days;

    const penalty = b.status === "confirmed" ? base * 0.05 : 0;

    await updateDoc(doc(db, "bookings", b.id), {
      status: "cancelled",
      penalty,
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "audit"), {
      action: `Booking cancelled (${b.customer}) — Days: ${days}${
        penalty ? ` — Penalty ${currencyGH(penalty)}` : ""
      }`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
    });

    await sendEmailNotification({
      toEmail: b.customerEmail,
      bookingId: b.id,
      actionType: "booking_cancelled",
      subject: `Booking Cancelled - ${b.carName || ""} (${b.carNumber || ""})`,
      message:
        `Hello ${b.customer || "Customer"},\n\n` +
        `Your booking has been CANCELLED.\n` +
        (penalty ? `Cancellation penalty: ${currencyGH(penalty)}\n\n` : "\n") +
        `Car: ${b.carName || ""} (${b.carNumber || ""})\n` +
        `Driver: ${b.driver || ""}\n` +
        `Travel: ${(b.travelFrom || "")} → ${(b.travelTo || "")}\n` +
        `Dates: ${normalizeSelectedDates(b.selectedDates)
          .map(toISODateString)
          .join(", ")}\n\n` +
        `If this is an error, please contact us.`,
    });
  };

  const exportCSV = () => {
    if (!can(role, "export"))
      return alert("You do not have permission to export.");
    if (!filteredBookings.length) return alert("No bookings to export.");

    const rows = filteredBookings.map((b) => {
      const days = normalizeSelectedDates(b.selectedDates).length;
      const totalAmount = computeBookingTotalAmount(b);
      const amountPaid = clampMoney(b.amountPaid || 0);
      const balance = Math.max(0, clampMoney(totalAmount) - amountPaid);
      const payStatus =
        b.paymentStatus || computePaymentStatus(totalAmount, amountPaid);

      return {
        Customer: (b.customer || "").replaceAll(",", " "),
        CustomerEmail: (b.customerEmail || "").replaceAll(",", " "),
        CustomerPhone: (b.customerPhone || "").replaceAll(",", " "),
        TravelFrom: (b.travelFrom || "").replaceAll(",", " "),
        TravelTo: (b.travelTo || "").replaceAll(",", " "),
        Car: `${b.carName || ""} (${b.carNumber || ""})`.replaceAll(",", " "),
        Driver: (b.driver || "").replaceAll(",", " "),
        DriverPhone: (b.driverPhone || "").replaceAll(",", " "),
        Status: b.status || "",
        Days: String(days),
        Dates: normalizeSelectedDates(b.selectedDates)
          .map(toISODateString)
          .join(" | "),
        DailyRate: String(b.dailyRate || 0),
        TotalAmount: String(totalAmount || 0),
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

  const getQuotationDiscountAmount = (baseAmount) => {
    const v = Number(quotationDiscountValue || 0);
    if (!Number.isFinite(v) || v <= 0) return 0;

    if (quotationDiscountType === "percentage") {
      return baseAmount * (v / 100);
    }

    if (quotationDiscountType === "fixed") {
      return v;
    }

    return 0;
  };

  const openQuotation = (b) => {
    setQuotationBooking(b);
    setQuotationNumber(generateDocNumber("QUO"));
    setQuotationNotes(companyProfile.quotationTerms || "");
    setQuotationDiscountType("none");
    setQuotationDiscountValue("");
    setActiveView("documents");
    setQuotationOpen(true);
  };

  const saveQuotationToAudit = async () => {
    if (!quotationBooking) return;

    const baseAmount = getBookingBaseAmount(quotationBooking);
    const discountAmount = getQuotationDiscountAmount(baseAmount);
    const vatSummary = computeGhanaVatSummary(
      baseAmount,
      discountAmount,
      companyProfile.vatEnabled
    );

    await addDoc(collection(db, "audit"), {
      action: `Quotation generated (${quotationNumber}) for ${quotationBooking.customer} — Car ${quotationBooking.carNumber} — Total ${currencyGH(vatSummary.grandTotal)}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
      quotationNumber,
      bookingId: quotationBooking.id,
      documentType: "quotation",
      vatSummary,
    });

    await sendEmailNotification({
      toEmail: quotationBooking.customerEmail,
      bookingId: quotationBooking.id,
      actionType: "quotation_generated",
      subject: `Quotation ${quotationNumber} - ${quotationBooking.carName || ""} (${quotationBooking.carNumber || ""})`,
      message:
        `${companyProfile.companyName || "MAALVILA Car Rental Services"}\n` +
        `${companyProfile.companyPhone ? `Tel: ${companyProfile.companyPhone}\n` : ""}` +
        `${companyProfile.companyEmail ? `Email: ${companyProfile.companyEmail}\n` : ""}` +
        `${companyProfile.companyTin ? `TIN: ${companyProfile.companyTin}\n` : ""}` +
        `${companyProfile.vatNumber ? `VAT No: ${companyProfile.vatNumber}\n` : ""}` +
        `\nQUOTATION\n` +
        `Quotation No: ${quotationNumber}\n` +
        `Customer: ${quotationBooking.customer || ""}\n` +
        `Car: ${quotationBooking.carName || ""} (${quotationBooking.carNumber || ""})\n` +
        `Driver: ${quotationBooking.driver || ""}\n` +
        `${quotationBooking.driverPhone ? `Driver Contact: ${quotationBooking.driverPhone}\n` : ""}` +
        `Travel: ${(quotationBooking.travelFrom || "")} → ${(quotationBooking.travelTo || "")}\n` +
        `Dates: ${normalizeSelectedDates(quotationBooking.selectedDates).map(toISODateString).join(", ")}\n` +
        `Daily Rate: ${currencyGH(quotationBooking.dailyRate || 0)}\n\n` +
        `Subtotal: ${currencyGH(vatSummary.subtotal)}\n` +
        `Discount: ${currencyGH(vatSummary.discount)}\n` +
        `Taxable Amount: ${currencyGH(vatSummary.taxableAmount)}\n` +
        `VAT @ 15%: ${currencyGH(vatSummary.vat)}\n` +
        `NHIL @ 2.5%: ${currencyGH(vatSummary.nhil)}\n` +
        `GETFund @ 2.5%: ${currencyGH(vatSummary.getfund)}\n` +
        `Grand Total: ${currencyGH(vatSummary.grandTotal)}\n\n` +
        `${quotationNotes || companyProfile.quotationTerms || ""}\n\n` +
        `Thank you.`,
      meta: {
        quotationNumber,
        vatSummary,
      },
    });

    setQuotationOpen(false);
  };

  const openInvoice = (b) => {
    setInvoiceBooking(b);
    setActiveView("documents");
    const d = new Date();
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    setInvoiceNumber(`INV-${format(d, "yyyyMMdd")}-${rand}`);
    setInvoiceNotes("");
    setInvoiceOpen(true);
  };

  const saveInvoiceToAudit = async () => {
    if (!invoiceBooking) return;

    // Save invoice record in audit
    await addDoc(collection(db, "audit"), {
      action: `Invoice generated (${invoiceNumber}) for ${invoiceBooking.customer} — Car ${invoiceBooking.carNumber}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
      invoiceNumber,
      bookingId: invoiceBooking.id,
    });

    // ✅ Send invoice email (restores behavior)
    const invoiceAmount =
      invoiceBooking.status === "confirmed"
        ? Number(invoiceBooking.confirmedAmount || 0)
        : Number(invoiceBooking.dailyRate || 0) *
          normalizeSelectedDates(invoiceBooking.selectedDates).length;

    await sendEmailNotification({
      toEmail: invoiceBooking.customerEmail,
      bookingId: invoiceBooking.id,
      actionType: "invoice_generated",
      subject: `Invoice ${invoiceNumber} - ${invoiceBooking.carName || ""} (${
        invoiceBooking.carNumber || ""
      })`,
      message:
        `Hello ${invoiceBooking.customer || "Customer"},\n\n` +
        `Here is your invoice.\n\n` +
        `Invoice No: ${invoiceNumber}\n` +
        `Car: ${invoiceBooking.carName || ""} (${invoiceBooking.carNumber || ""})\n` +
        `Driver: ${invoiceBooking.driver || ""}\n` +
        `Travel: ${(invoiceBooking.travelFrom || "")} → ${(invoiceBooking.travelTo || "")}\n` +
        `Dates: ${normalizeSelectedDates(invoiceBooking.selectedDates)
          .map(toISODateString)
          .join(", ")}\n` +
        `Daily Rate: ${currencyGH(invoiceBooking.dailyRate || 0)}\n` +
        `Amount: ${currencyGH(invoiceAmount)}\n\n` +
        (invoiceNotes ? `Notes: ${invoiceNotes}\n\n` : "") +
        `Thank you.`,
      meta: { invoiceNumber },
    });

    setInvoiceOpen(false);
  };

  // Payments
  const openPayment = (b) => {
    if (!can(role, "recordPayment")) {
      alert("Only Admin/Staff can record payments.");
      return;
    }

    // ✅ Pre-fill amount with BALANCE to avoid blank form
    const totalAmount = computeBookingTotalAmount(b);
    const paid = clampMoney(b.amountPaid || 0);
    const balance = Math.max(0, clampMoney(totalAmount) - paid);

    setPaymentBooking(b);
    setPaymentAmount(balance ? String(balance) : "");
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentNote("");
    setPaymentOpen(true);
  };

  const recordPayment = async () => {
    if (!paymentBooking?.id) return;
    if (!can(role, "recordPayment"))
      return alert("Only Admin/Staff can record payments.");

    const amt = clampMoney(paymentAmount);
    if (!amt || amt <= 0) return alert("Enter a valid payment amount.");

    const booking = paymentBooking;
    const bookingRef = doc(db, "bookings", booking.id);

    // Add payment record to subcollection
    await addDoc(collection(db, "bookings", booking.id, "payments"), {
      amount: amt,
      method: paymentMethod || "cash",
      reference: (paymentReference || "").trim(),
      note: (paymentNote || "").trim(),
      paidAt: serverTimestamp(),
      recordedByEmail: user?.email || roleEmail || "",
      recordedByUid: user?.uid || "",
    });

    // Update aggregate fields on booking doc
    const totalAmount = computeBookingTotalAmount(booking);
    const currentPaid = clampMoney(booking.amountPaid || 0);
    const newAmountPaid = clampMoney(currentPaid + amt);
    const newPayStatus = computePaymentStatus(totalAmount, newAmountPaid);

    await updateDoc(bookingRef, {
      amountPaid: increment(amt),
      paymentStatus: newPayStatus,
      paymentUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "audit"), {
      action: `Payment recorded for ${booking.customer} (${booking.carNumber}) — ${currencyGH(
        amt
      )} — Status: ${newPayStatus}`,
      userId: user?.email || roleEmail || "",
      uid: user?.uid || "",
      time: serverTimestamp(),
      bookingId: booking.id,
      paymentAmount: amt,
      paymentMethod: paymentMethod || "cash",
    });

    // Email receipt (only if customerEmail exists)
    await sendEmailNotification({
      toEmail: booking.customerEmail,
      bookingId: booking.id,
      actionType: "payment_recorded",
      subject: `Payment Received - ${booking.carName || ""} (${booking.carNumber || ""})`,
      message:
        `Hello ${booking.customer || "Customer"},\n\n` +
        `We have received your payment.\n\n` +
        `Amount: ${currencyGH(amt)}\n` +
        `Method: ${paymentMethod || "cash"}\n` +
        (paymentReference ? `Reference: ${paymentReference}\n` : "") +
        (paymentNote ? `Note: ${paymentNote}\n` : "") +
        `\nThank you.`,
      meta: { paymentStatus: newPayStatus },
    });

    // Close/reset
    setPaymentAmount("");
    setPaymentReference("");
    setPaymentNote("");
    setPaymentOpen(false);
  };

  /* ---------------------------- RENDER GUARDS ---------------------------- */

  if (!user) {
    return (
      <div className="p-10 text-center text-xl">
        Login first to load dashboard
      </div>
    );
  }

  if (loadingRole) {
    return <div className="p-10 text-center text-lg">Loading role...</div>;
  }

  /* ---------------------------- UI COMPONENTS ---------------------------- */

  const kpiCards = [
    {
      label: "Bookings",
      value: bookings.length,
      icon: <ClipboardList className="w-5 h-5" />,
      bg: "bg-blue-50 border-blue-100",
      tip: "Total bookings (all statuses).",
    },
    {
      label: "Cars",
      value: carsKPI,
      icon: <Car className="w-5 h-5" />,
      bg: "bg-amber-50 border-amber-100",
      tip: "Unique cars from master list + historical bookings.",
    },
    {
      label: "Confirmed Revenue",
      value: currencyGH(revenue),
      icon: <Banknote className="w-5 h-5" />,
      bg: "bg-emerald-50 border-emerald-100",
      tip: "Sum of confirmed booking amounts only.",
    },
    {
      label: "Outstanding Balance",
      value: currencyGH(outstandingTotal),
      icon: <Banknote className="w-5 h-5" />,
      bg: "bg-violet-50 border-violet-100",
      tip: "Total unpaid balances across all bookings.",
    },
    {
      label: "Paid (Last 30 days)",
      value: currencyGH(paidLast30Days),
      icon: <Banknote className="w-5 h-5" />,
      bg: "bg-sky-50 border-sky-100",
      tip: "Payments on bookings updated in the last 30 days (approx).",
    },
    {
      label: "Penalties",
      value: currencyGH(penaltyTotal),
      icon: <Banknote className="w-5 h-5" />,
      bg: "bg-rose-50 border-rose-100",
      tip: "Cancellation penalties (not part of revenue).",
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto bg-slate-50 min-h-screen">
{/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold"
        >
          Rental Dashboard - Phase 1 Test
        </motion.h1>

        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-700">
            Signed in: <b>{roleEmail || user.email || "unknown"}</b> • Role:{" "}
            <b className="uppercase">{role}</b>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={logout}
            title="Logout"
          >
            <LogOut className="w-4 h-4" /> Logout
          </Button>
        </div>
      </div>

      
      {/* TABS / VIEWS */}
      <Card className="rounded-2xl border bg-white">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
              { key: "bookings", label: "Bookings", icon: <ClipboardList className="w-4 h-4" /> },
              { key: "cars", label: "Cars", icon: <Car className="w-4 h-4" /> },
              { key: "documents", label: "Documents", icon: <ReceiptText className="w-4 h-4" /> },
              { key: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
              { key: "audit", label: "Audit Trail", icon: <FileText className="w-4 h-4" /> },
            ].map((tab) => (
              <Button
                key={tab.key}
                variant={activeView === tab.key ? "default" : "outline"}
                className="gap-2"
                onClick={() => setActiveView(tab.key)}
              >
                {tab.icon}
                {tab.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {activeView === "overview" && (
        <>
{/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {kpiCards.map((k) => (
          <Card
            key={k.label}
            className={`rounded-2xl border ${k.bg}`}
            title={k.tip}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-white/80">{k.icon}</div>
              <div>
                <div className="text-xs text-gray-600">{k.label}</div>
                <div className="text-xl font-bold">{k.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CHARTS */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-lg">Top Cars (Bookings Count)</h2>
              <span
                className="text-xs text-gray-500"
                title="Counts how many times each car number appears in bookings."
              >
                Hover bars for details
              </span>
            </div>
            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCarsBarData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" hide />
                  <YAxis />
                  <ReTooltip
                    formatter={(v) => [`${v}`, "Bookings"]}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.label || label
                    }
                  />
                  <Bar dataKey="count">
                    {topCarsBarData.map((row) => (
                      <Cell key={row.carNo} fill={hashColor(row.carNo)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Showing top 12 cars by booking count.
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-lg">Booking Status</h2>
              <span
                className="text-xs text-gray-500"
                title="Dynamic colors adapt automatically if new statuses appear."
              >
                Hover slices for details
              </span>
            </div>
            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <ReTooltip />
                  <Legend />
                  <Pie
                    data={statusPieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label
                  >
                    {statusPieData.map((s) => (
                      <Cell key={s.name} fill={hashColor(s.name)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ADVANCED ANALYTICS */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <h2 className="font-semibold text-lg">
                Revenue Trend (Last 90 Days)
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">Group by:</span>
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={trendMode}
                  onChange={(e) => setTrendMode(e.target.value)}
                  title="Switch between Monthly and Quarterly trend"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
            </div>

            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <ReTooltip formatter={(v) => [currencyGH(v), "Revenue"]} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={hashColor("revenue")}
                    strokeWidth={3}
                    dot
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Confirmed revenue only (pending/cancelled excluded).
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h2 className="font-semibold text-lg">
              Utilization (Last 90 Days) — Top Cars
            </h2>
            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={utilizationTopCars}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" hide />
                  <YAxis />
                  <ReTooltip
                    formatter={(v) => [`${v}`, "Booked days"]}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.label || label
                    }
                  />
                  <Bar dataKey="bookedDays">
                    {utilizationTopCars.map((row) => (
                      <Cell
                        key={row.carNo}
                        fill={hashColor("util-" + row.carNo)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Counts unique booked days per car (excluding cancelled).
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TOP CUSTOMERS */}
      <Card className="rounded-2xl shadow">
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">
            Top Customers (Confirmed Revenue)
          </h2>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c) => (
                  <tr
                    key={c.customerName}
                    className="border-b hover:bg-white"
                  >
                    <td className="py-2 pr-4 font-medium">{c.customerName}</td>
                    <td className="py-2 pr-4">{currencyGH(c.total)}</td>
                  </tr>
                ))}
                {!topCustomers.length && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={2}>
                      No confirmed bookings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

              </>
      )}

      {activeView === "cars" && (
        <>
{/* ADD CAR (ADMIN ONLY) */}
      {can(role, "addCar") && (
        <Card className="rounded-2xl shadow">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">Add Car</h2>
            <div className="grid md:grid-cols-3 gap-2">
              <Input
                placeholder="Car Name"
                value={newCarName}
                onChange={(e) => setNewCarName(e.target.value)}
              />
              <Input
                placeholder="Car Number"
                value={newCarNumber}
                onChange={(e) => setNewCarNumber(e.target.value)}
              />
              <Button onClick={addCar}>Add Car</Button>
            </div>
            <div className="text-xs text-gray-500">
              Duplicate car numbers are blocked automatically.
            </div>
          </CardContent>
        </Card>
      )}

              </>
      )}

      {activeView === "bookings" && (
        <>
{/* BOOKING FORM (ADMIN + STAFF) */}
      {can(role, "addBooking") && (
        <Card className="rounded-2xl shadow">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">
              {editBookingId ? "Edit Booking" : "New Booking"}
            </h2>

            <div className="grid md:grid-cols-7 gap-2 items-start">
              <Input
                placeholder="Customer Name"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
              <Input
                placeholder="Customer Email (for notifications)"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
              <Input
                placeholder="Customer Phone (optional)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />

              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={carNumber}
                onChange={(e) => setCarNumber(e.target.value)}
              >
                <option value="">Select Car</option>
                {cars.map((c) => (
                  <option key={c.id} value={c.number}>
                    {c.name} ({c.number})
                  </option>
                ))}
              </select>

              <Input
                placeholder="Driver Name"
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
              />
              <Input
                placeholder="Driver Contact"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Daily Rate (GH₵)"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </div>

            <div className="grid md:grid-cols-6 gap-2 items-start">
              <Input
                placeholder="Travel From (e.g., Accra)"
                value={travelFrom}
                onChange={(e) => setTravelFrom(e.target.value)}
              />
              <Input
                placeholder="Travel To (e.g., Kumasi)"
                value={travelTo}
                onChange={(e) => setTravelTo(e.target.value)}
              />

              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={preferredChannel}
                onChange={(e) => setPreferredChannel(e.target.value)}
              >
                <option value="email">Email (default)</option>
                <option value="whatsapp" disabled>
                  WhatsApp (later)
                </option>
                <option value="sms" disabled>
                  SMS (later)
                </option>
              </select>

              <div className="md:col-span-2">
                <div className="text-sm font-medium flex items-center gap-2 mb-2">
                  <CalendarDays className="w-4 h-4" />
                  Select Trip Days (multi-select)
                </div>
                <div className="inline-block border rounded-xl p-2 bg-white">
                  <Calendar
                    mode="multiple"
                    selected={selectedDates}
                    onSelect={(dates) =>
                      setSelectedDates(normalizeSelectedDates(dates))
                    }
                    className="rounded-lg"
                  />
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Clicking the same day twice will not duplicate it (auto-dedupe).
                </div>
              </div>

              <div className="flex items-end">
                <Button onClick={saveBooking} className="w-full">
                  {editBookingId ? "Update Booking" : "Add Booking"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FILTER + EXPORT (ALL ROLES) */}
      <Card className="rounded-2xl shadow">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <h2 className="text-lg font-semibold">Filter / Export</h2>
            <div className="text-xs text-gray-500">
              Showing <b>{filteredBookings.length}</b> / {bookings.length} bookings
            </div>
          </div>

          <div className="grid md:grid-cols-6 gap-2">
            <select
              className="border rounded-lg p-2 text-sm h-10"
              value={filterCar}
              onChange={(e) => setFilterCar(e.target.value)}
            >
              <option value="">All Cars</option>
              {cars.map((c) => (
                <option key={c.id} value={c.number}>
                  {c.name} ({c.number})
                </option>
              ))}
            </select>

            <select
              className="border rounded-lg p-2 text-sm h-10"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <Input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
            />
            <Input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
            />

            <Button onClick={exportCSV} disabled={!can(role, "export")}>
              Export CSV
            </Button>
            <Button
              onClick={() => window.print()}
              variant="outline"
              disabled={!can(role, "export")}
            >
              Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* BOOKINGS TABLE */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Bookings</h2>

          <div className="space-y-3">
            {filteredBookings.map((b) => {
              const days = normalizeSelectedDates(b.selectedDates).length;
              const totalAmount = computeBookingTotalAmount(b);
              const amountPaid = clampMoney(b.amountPaid || 0);
              const balance = Math.max(0, clampMoney(totalAmount) - amountPaid);
              const payStatus =
                b.paymentStatus || computePaymentStatus(totalAmount, amountPaid);

              const statusClass =
                b.status === "confirmed"
                  ? "text-green-700 bg-green-50 border-green-200"
                  : b.status === "pending"
                  ? "text-yellow-800 bg-yellow-50 border-yellow-200"
                  : "text-red-700 bg-red-50 border-red-200";

              const payClass =
                payStatus === "paid"
                  ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                  : payStatus === "partial"
                  ? "text-violet-800 bg-violet-50 border-violet-200"
                  : "text-slate-700 bg-slate-50 border-slate-200";

              const canEdit = can(role, "editBooking");
              const canConfirm =
                can(role, "confirmBooking") && b.status === "pending";
              const canCancel =
                can(role, "cancelBooking") && b.status !== "cancelled";
              const canPay = can(role, "recordPayment");

              return (
                <div
                  key={b.id}
                  className="border rounded-2xl p-3 bg-white hover:shadow-sm transition"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-semibold text-lg">{b.customer}</div>

                      <div className="text-sm text-gray-700">
                        <b>{b.carName}</b> ({b.carNumber}) • Driver:{" "}
                        <b>{b.driver}</b>
                        {b.driverPhone ? <span> • Driver Contact: <b>{b.driverPhone}</b></span> : null}
                      </div>

                      {(b.travelFrom || b.travelTo) && (
                        <div className="text-sm text-gray-700">
                          Travel: <b>{b.travelFrom || "—"}</b> →{" "}
                          <b>{b.travelTo || "—"}</b>
                        </div>
                      )}

                      {(b.customerEmail || b.customerPhone) && (
                        <div className="text-sm text-gray-700">
                          Contact: <b>{b.customerEmail || "—"}</b>
                          {b.customerPhone ? (
                            <span> • {b.customerPhone}</span>
                          ) : null}
                        </div>
                      )}

                      <div className="text-sm text-gray-700">
                        Dates:{" "}
                        <span className="font-medium">
                          {normalizeSelectedDates(b.selectedDates)
                            .map((d) => toISODateString(d))
                            .join(", ")}
                        </span>{" "}
                        <span className="text-gray-500">
                          ({days} day{days === 1 ? "" : "s"})
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 text-sm">
                        <span
                          className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${statusClass}`}
                        >
                          Status: {b.status || "pending"}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-1 border rounded-xl text-xs ${payClass}`}
                        >
                          Payment: {payStatus}
                        </span>
                      </div>

                      <div className="text-sm">
                        Daily Rate: <b>{currencyGH(b.dailyRate || 0)}</b> • Total:{" "}
                        <b>{currencyGH(totalAmount)}</b> • Paid:{" "}
                        <b>{currencyGH(amountPaid)}</b> • Balance:{" "}
                        <b>{currencyGH(balance)}</b>
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {canConfirm && (
                        <Button onClick={() => confirmBooking(b)} title="Admin only">
                          Confirm
                        </Button>
                      )}

                      {canCancel && (
                        <Button
                          variant="destructive"
                          onClick={() => cancelBooking(b)}
                          title="Admin only"
                        >
                          Cancel
                        </Button>
                      )}

                      {canEdit && (
                        <Button
                          variant="outline"
                          onClick={() => editBooking(b)}
                          title="Admin/Staff"
                        >
                          Edit
                        </Button>
                      )}

                      {canPay && (
                        <Button
                          variant="outline"
                          onClick={() => openPayment(b)}
                          title="Admin/Staff"
                        >
                          Record Payment
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => openQuotation(b)}
                        title="Generate quotation"
                      >
                        <ScrollText className="w-4 h-4" /> Quote
                      </Button>

                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => openInvoice(b)}
                        title="Generate invoice"
                      >
                        <FileText className="w-4 h-4" /> Invoice
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredBookings.length && (
              <div className="text-sm text-gray-500">
                No bookings match your filter.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PAYMENTS MODAL */}
      {paymentOpen && paymentBooking && (
        <Card className="rounded-2xl border-2">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <Button variant="outline" onClick={() => setPaymentOpen(false)}>
                Close
              </Button>
            </div>

            <div className="text-sm text-gray-700">
              Booking: <b>{paymentBooking.customer}</b> • Car:{" "}
              <b>{paymentBooking.carNumber}</b>
            </div>

            <div className="grid md:grid-cols-5 gap-2">
              <Input
                type="number"
                placeholder="Amount (GH₵)"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="momo">MoMo</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
              <Input
                placeholder="Reference (optional)"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
              <Input
                placeholder="Note (optional)"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
              />
              <Button onClick={recordPayment}>Save Payment</Button>
            </div>

            <div className="mt-3">
              <h3 className="font-semibold text-sm mb-2">Payment History</h3>
              <div className="space-y-2">
                {paymentHistory.map((p) => (
                  <div
                    key={p.id}
                    className="text-sm border rounded-xl p-2 bg-white"
                  >
                    <div className="font-medium">
                      {currencyGH(p.amount)} • {p.method || "cash"}
                      {p.reference ? ` • Ref: ${p.reference}` : ""}
                    </div>
                    {p.note ? (
                      <div className="text-xs text-gray-600 mt-1">{p.note}</div>
                    ) : null}
                    <div className="text-xs text-gray-500">
                      {safeTimeToLocaleString(p.paidAt)} • by{" "}
                      {p.recordedByEmail || "unknown"}
                    </div>
                  </div>
                ))}
                {!paymentHistory.length && (
                  <div className="text-sm text-gray-500">
                    No payments recorded yet.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

              </>
      )}

      {activeView === "documents" && (
        <>

      {/* QUOTATION MODAL */}
      {activeView === "documents" && quotationOpen && quotationBooking && (
        <Card className="rounded-2xl border-2">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Quotation Generator</h2>
              <Button variant="outline" onClick={() => setQuotationOpen(false)}>
                Close
              </Button>
            </div>

            {companyProfile.letterheadUrl ? (
              <img
                src={companyProfile.letterheadUrl}
                alt="Letterhead"
                className="w-full max-h-32 object-contain border rounded-xl bg-white"
              />
            ) : companyProfile.logoUrl ? (
              <img
                src={companyProfile.logoUrl}
                alt="Logo"
                className="h-20 object-contain"
              />
            ) : null}

            <div className="grid md:grid-cols-4 gap-2">
              <Input
                placeholder="Quotation Number"
                value={quotationNumber}
                onChange={(e) => setQuotationNumber(e.target.value)}
              />

              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={quotationDiscountType}
                onChange={(e) => setQuotationDiscountType(e.target.value)}
              >
                <option value="none">No Discount</option>
                <option value="fixed">Fixed Discount</option>
                <option value="percentage">Percentage Discount</option>
              </select>

              <Input
                type="number"
                placeholder="Discount Value"
                value={quotationDiscountValue}
                onChange={(e) => setQuotationDiscountValue(e.target.value)}
              />

              <Button onClick={saveQuotationToAudit}>Save + Email Quote</Button>
            </div>

            <Input
              placeholder="Quotation notes / terms"
              value={quotationNotes}
              onChange={(e) => setQuotationNotes(e.target.value)}
            />

            {(() => {
              const baseAmount = getBookingBaseAmount(quotationBooking);
              const discountAmount = getQuotationDiscountAmount(baseAmount);
              const vatSummary = computeGhanaVatSummary(
                baseAmount,
                discountAmount,
                companyProfile.vatEnabled
              );

              return (
                <div className="border rounded-xl p-4 bg-white space-y-2">
                  <div className="text-center">
                    <div className="text-xl font-bold">
                      {companyProfile.companyName || "MAALVILA Car Rental Services"}
                    </div>
                    <div className="text-xs text-gray-600">
                      {companyProfile.companyAddress || ""}
                    </div>
                    <div className="text-xs text-gray-600">
                      {companyProfile.companyPhone || ""}{" "}
                      {companyProfile.companyEmail ? `• ${companyProfile.companyEmail}` : ""}
                    </div>
                    <div className="text-xs text-gray-600">
                      {companyProfile.companyTin ? `TIN: ${companyProfile.companyTin}` : ""}
                      {companyProfile.vatNumber ? ` • VAT No: ${companyProfile.vatNumber}` : ""}
                    </div>
                  </div>

                  <div className="border-t pt-3">
                    <div className="text-sm text-gray-600">Quotation</div>
                    <div className="text-lg font-bold">{quotationNumber}</div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-2 text-sm">
                    <div>
                      Customer: <b>{quotationBooking.customer}</b>
                    </div>
                    <div>
                      Email: <b>{quotationBooking.customerEmail || "—"}</b>
                    </div>
                    <div>
                      Car: <b>{quotationBooking.carName}</b> ({quotationBooking.carNumber})
                    </div>
                    <div>
                      Driver: <b>{quotationBooking.driver || "—"}</b>
                      {quotationBooking.driverPhone ? (
                        <span> • {quotationBooking.driverPhone}</span>
                      ) : null}
                    </div>
                    <div>
                      Travel: <b>{quotationBooking.travelFrom || "—"}</b> →{" "}
                      <b>{quotationBooking.travelTo || "—"}</b>
                    </div>
                    <div>
                      Dates:{" "}
                      <b>
                        {normalizeSelectedDates(quotationBooking.selectedDates)
                          .map(toISODateString)
                          .join(", ")}
                      </b>
                    </div>
                  </div>

                  <div className="border-t pt-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <b>{currencyGH(vatSummary.subtotal)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <b>{currencyGH(vatSummary.discount)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Taxable Amount</span>
                      <b>{currencyGH(vatSummary.taxableAmount)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>VAT @ 15%</span>
                      <b>{currencyGH(vatSummary.vat)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>NHIL @ 2.5%</span>
                      <b>{currencyGH(vatSummary.nhil)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>GETFund @ 2.5%</span>
                      <b>{currencyGH(vatSummary.getfund)}</b>
                    </div>
                    <div className="flex justify-between border-t pt-2 text-base">
                      <span>Grand Total</span>
                      <b>{currencyGH(vatSummary.grandTotal)}</b>
                    </div>
                  </div>

                  {quotationNotes ? (
                    <div className="text-xs text-gray-600 border-t pt-2">
                      {quotationNotes}
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}
{/* INVOICE MODAL */}
      {invoiceOpen && invoiceBooking && (
        <Card className="rounded-2xl border-2">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Invoice Generator</h2>
              <Button variant="outline" onClick={() => setInvoiceOpen(false)}>
                Close
              </Button>
            </div>

            <div className="grid md:grid-cols-3 gap-2">
              <Input
                placeholder="Invoice Number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
              <Input
                placeholder="Notes (optional)"
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
              />
              <Button onClick={saveInvoiceToAudit}>Save + Email Invoice</Button>
            </div>

            <div className="border rounded-xl p-3 bg-white">
              {companyProfile.letterheadUrl ? (
                <img
                  src={companyProfile.letterheadUrl}
                  alt="Letterhead"
                  className="w-full max-h-32 object-contain border rounded-xl bg-white mb-3"
                />
              ) : companyProfile.logoUrl ? (
                <img
                  src={companyProfile.logoUrl}
                  alt="Logo"
                  className="h-20 object-contain mb-3"
                />
              ) : null}

              <div className="text-center mb-3">
                <div className="text-xl font-bold">
                  {companyProfile.companyName || "MAALVILA Car Rental Services"}
                </div>
                <div className="text-xs text-gray-600">
                  {companyProfile.companyAddress || ""}
                </div>
                <div className="text-xs text-gray-600">
                  {companyProfile.companyPhone || ""}{" "}
                  {companyProfile.companyEmail ? `• ${companyProfile.companyEmail}` : ""}
                </div>
                <div className="text-xs text-gray-600">
                  {companyProfile.companyTin ? `TIN: ${companyProfile.companyTin}` : ""}
                  {companyProfile.vatNumber ? ` • VAT No: ${companyProfile.vatNumber}` : ""}
                </div>
              </div>

              <div className="text-sm text-gray-600">Invoice</div>
              <div className="text-xl font-bold">{invoiceNumber}</div>

              <div className="mt-2 text-sm">
                Customer: <b>{invoiceBooking.customer}</b>
              </div>
              {invoiceBooking.customerEmail ? (
                <div className="text-sm">
                  Email: <b>{invoiceBooking.customerEmail}</b>
                </div>
              ) : null}
              {invoiceBooking.customerPhone ? (
                <div className="text-sm">
                  Phone: <b>{invoiceBooking.customerPhone}</b>
                </div>
              ) : null}

              <div className="text-sm">
                Car: <b>{invoiceBooking.carName}</b> ({invoiceBooking.carNumber})
              </div>
              <div className="text-sm">
                Driver: <b>{invoiceBooking.driver}</b>
                {invoiceBooking.driverPhone ? (
                  <span> • Driver Contact: <b>{invoiceBooking.driverPhone}</b></span>
                ) : null}
              </div>
              {(invoiceBooking.travelFrom || invoiceBooking.travelTo) && (
                <div className="text-sm">
                  Travel: <b>{invoiceBooking.travelFrom || "—"}</b> →{" "}
                  <b>{invoiceBooking.travelTo || "—"}</b>
                </div>
              )}
              <div className="text-sm">
                Dates:{" "}
                <b>
                  {normalizeSelectedDates(invoiceBooking.selectedDates)
                    .map((d) => toISODateString(d))
                    .join(", ")}
                </b>
              </div>
              <div className="text-sm">
                Daily Rate: <b>{currencyGH(invoiceBooking.dailyRate || 0)}</b>
              </div>
              <div className="text-sm">
                Amount:{" "}
                <b>
                  {currencyGH(
                    invoiceBooking.status === "confirmed"
                      ? invoiceBooking.confirmedAmount || 0
                      : (invoiceBooking.dailyRate || 0) *
                          normalizeSelectedDates(invoiceBooking.selectedDates)
                            .length
                  )}
                </b>
              </div>

              {invoiceNotes ? (
                <div className="text-sm mt-2">
                  Notes: <b>{invoiceNotes}</b>
                </div>
              ) : null}

              <div className="text-xs text-gray-500 mt-2">
                Generated by: {roleEmail || user.email || ""} •{" "}
                {new Date().toLocaleString()}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

              </>
      )}

      {/* SETTINGS */}
      {activeView === "settings" && (
        <Card className="rounded-2xl shadow">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Company Profile & Document Settings</h2>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <Input
                placeholder="Company Name"
                value={companyProfile.companyName || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, companyName: e.target.value }))
                }
              />

              <Input
                placeholder="Company Email"
                value={companyProfile.companyEmail || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, companyEmail: e.target.value }))
                }
              />

              <Input
                placeholder="Company Phone"
                value={companyProfile.companyPhone || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, companyPhone: e.target.value }))
                }
              />

              <Input
                placeholder="Company Address"
                value={companyProfile.companyAddress || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, companyAddress: e.target.value }))
                }
              />

              <Input
                placeholder="TIN"
                value={companyProfile.companyTin || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, companyTin: e.target.value }))
                }
              />

              <Input
                placeholder="VAT Registration Number"
                value={companyProfile.vatNumber || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, vatNumber: e.target.value }))
                }
              />

              <Input
                placeholder="Logo URL"
                value={companyProfile.logoUrl || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, logoUrl: e.target.value }))
                }
              />

              <Input
                placeholder="Letterhead URL"
                value={companyProfile.letterheadUrl || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, letterheadUrl: e.target.value }))
                }
              />

              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={companyProfile.vatEnabled ? "yes" : "no"}
                onChange={(e) =>
                  setCompanyProfile((p) => ({
                    ...p,
                    vatEnabled: e.target.value === "yes",
                  }))
                }
              >
                <option value="yes">VAT Enabled</option>
                <option value="no">VAT Disabled</option>
              </select>

              <select
                className="border rounded-lg p-2 text-sm h-10"
                value={companyProfile.vatMode || "exclusive"}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, vatMode: e.target.value }))
                }
              >
                <option value="exclusive">VAT Exclusive Pricing</option>
                <option value="inclusive">VAT Inclusive Pricing (later)</option>
              </select>
            </div>

            <div className="grid gap-3">
              <Input
                placeholder="Quotation Terms"
                value={companyProfile.quotationTerms || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, quotationTerms: e.target.value }))
                }
              />

              <Input
                placeholder="Invoice Footer"
                value={companyProfile.invoiceFooter || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, invoiceFooter: e.target.value }))
                }
              />

              <Input
                placeholder="Receipt Footer"
                value={companyProfile.receiptFooter || ""}
                onChange={(e) =>
                  setCompanyProfile((p) => ({ ...p, receiptFooter: e.target.value }))
                }
              />
            </div>

            <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
              Ghana VAT-ready format: VAT 15%, NHIL 2.5%, GETFund 2.5%.
              If MAALVILA is required to issue certified e-VAT invoices, this document format
              may later need integration with a GRA-certified invoicing system.
            </div>

            <Button onClick={saveCompanyProfile} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Company Settings"}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeView === "audit" && (
        <>
{/* AUDIT TRAIL */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="text-lg font-semibold mb-3">Audit Trail</h2>
          <div className="space-y-2">
            {audit.map((a) => (
              <div key={a.id} className="text-sm border-b py-2">
                <div className="font-medium">{a.action}</div>
                <div className="text-xs text-gray-500">
                  User:{" "}
                  <b>
                    {a.userId ||
                      a.createdByEmail ||
                      roleEmail ||
                      user.email ||
                      "unknown"}
                  </b>{" "}
                  {a.uid ? <span>• UID: {a.uid}</span> : null} •{" "}
                  {safeTimeToLocaleString(a.time) || "—"}
                  {a.invoiceNumber ? (
                    <span> • Invoice: {a.invoiceNumber}</span>
                  ) : null}
                </div>
              </div>
            ))}
            {!audit.length && (
              <div className="text-sm text-gray-500">No audit events yet.</div>
            )}
          </div>
        </CardContent>
      </Card>        </>
      )}
    </div>
  );
}