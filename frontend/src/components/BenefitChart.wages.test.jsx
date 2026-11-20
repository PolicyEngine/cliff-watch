// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { cloneElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test, vi } from 'vitest'
import BenefitChart from './BenefitChart'

// Give Recharts the dimensions that ResizeObserver supplies in a browser.
vi.mock('recharts', async load => ({
  ...await load(),
  ResponsiveContainer: ({ children }) => cloneElement(children, { width: 850, height: 450 }),
}))

function renderWageChart(fixedWages) {
  const data = [0, 50_000, 100_000].map(wages => ({
    earned_income: wages + fixedWages, net_resources: wages + fixedWages,
  }))
  const result = document.createElement('div')
  result.innerHTML = renderToStaticMarkup(<BenefitChart data={data} />)
  const ticks = [...result.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')]
  return { text: result.textContent, ticks }
}

test('the first household-wage observation starts at the left edge for one or two earners', () => {
  const zero = renderWageChart(0)
  const fixed = renderWageChart(110_000)
  assert.equal(zero.ticks[0].textContent, '$0')
  assert.equal(fixed.ticks[0].textContent, '$110,000')
  assert.equal(fixed.ticks.at(-1).textContent, '$210,000')
  assert.equal(fixed.ticks[0].getAttribute('x'), zero.ticks[0].getAttribute('x'))
  assert.match(fixed.text, /Other household members earn \$110,000 per year\. Their wages stay fixed/)
  assert.doesNotMatch(zero.text, /Their wages stay fixed/)
})
