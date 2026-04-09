export function niceTicks(dataMax, targetCount = 5) {
  if (dataMax <= 0) return [0]
  const rawStep = dataMax / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude

  let niceStep
  if (normalized <= 1) niceStep = 1 * magnitude
  else if (normalized <= 2) niceStep = 2 * magnitude
  else if (normalized <= 2.5) niceStep = 2.5 * magnitude
  else if (normalized <= 5) niceStep = 5 * magnitude
  else niceStep = 10 * magnitude

  const niceMax = Math.ceil(dataMax / niceStep) * niceStep
  const ticks = []
  for (let value = 0; value <= niceMax; value += niceStep) {
    ticks.push(Math.round(value * 1e10) / 1e10)
  }
  return ticks
}
