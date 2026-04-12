"use client";

import { Suspense } from "react";
import AuthGate from "@/components/AuthGate";
import RandomPageApp from "@/components/RandomPageApp";

export default function SettingsPage() {
  return (
    <AuthGate>
      <Suspense>
        <RandomPageApp />
      </Suspense>
    </AuthGate>
  );
}
