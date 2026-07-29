export function applyWeatherPaceAdjustment(baseSeconds: number, temperatureC: number, humidityPercent: number) {
  const heatPenalty = Math.max(0, temperatureC - 20) * 1.5;
  const humidityPenalty = Math.max(0, humidityPercent - 60) * 0.2;
  return Math.round(baseSeconds + heatPenalty + humidityPenalty);
}
