"use client";

import { useSyncExternalStore } from "react";

const getLocalDay = () => new Date().toDateString();
const getServerDay = () => null;
const subscribe = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", onChange); };
};

export function useLocalDay(): string | null {
  return useSyncExternalStore(subscribe, getLocalDay, getServerDay);
}
