export async function drawCliffWatchSample(options) {
  const { drawUsSampleHousehold } = await import('policyengine-household-wizard/us-household/samples')
  return drawUsSampleHousehold(options)
}

export async function getCliffWatchSample(id) {
  const { getUsSampleHousehold } = await import('policyengine-household-wizard/us-household/samples')
  return getUsSampleHousehold(id)
}
