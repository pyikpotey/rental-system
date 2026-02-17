"use client";

import { useState, useEffect } from "react";
import { auth } from "../lib/firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import Dashboard from "../components/Dashboard"; // We'll create this next

export default function LoginPage() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onAuthStateChanged(auth, setUser);
  }, []);

  const handleLogin = async () => {
  setError("");
  console.log("Attempting login with", email, password); // debug
  try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Login successful");
  } catch (err) {
    console.log("Login failed:", err.code, err.message); // debug
    setError("Invalid email or password");
  }
};

  if (user) return <Dashboard />; // Shows dashboard if logged in

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded shadow-md w-96">
        <h2 className="text-2xl font-bold mb-4">Team Login</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full mb-3"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full mb-3"
        />
        {error && <p className="text-red-500 mb-3">{error}</p>}
        <button
          onClick={handleLogin}
          className="bg-black text-white p-2 w-full rounded"
        >
          Login
        </button>
      </div>
    </div>
  );
}