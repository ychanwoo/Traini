export type GarminSnapshot = {
  vo2Max: number | null;
  averageHeartRate: number | null;
  averagePaceSecondsPerKm?: number | null;
  sleepScore: number | null;
  hrvStatus: "low" | "normal" | "high" | null;
  weeklyDistanceKm: number | null;
  updatedAt: string;
};

export type GarminConnectionStatus = "not_connected" | "connected" | "expired";
