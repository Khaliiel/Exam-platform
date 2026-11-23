"use client";
import { useEffect } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => { document.body.classList.add("calm"); return () => document.body.classList.remove("calm"); }, []);
  return <>{children}</>;
}
