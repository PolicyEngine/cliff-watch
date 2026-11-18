export async function drawCliffWatchSample(options) {
  const { drawUsSampleHousehold } = await import('policyengine-household-wizard/us-household/samples')
  return drawUsSampleHousehold(options)
}
