"use client";
import { useEffect, useState } from "react";
import { detectDevice } from "@/lib/device";

export default function DeviceGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => setOk(detectDevice().allowed);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  if (ok === null) return null;
  if (!ok)
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <section className="glass max-w-xl p-10 text-center">
          <h1 className="text-3xl text-navy mb-4">Desktop or Laptop Required</h1>
          <p>
            This assessment is strictly optimized for Windows, macOS, or Linux laptops with a working webcam. Please open
            this link on a computer to proceed.
          </p>
        </section>
      </main>
    );
  return <>{children}</>;
}
