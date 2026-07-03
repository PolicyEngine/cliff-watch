import {
  MTR_CAP,
  MTR_OTHER_KEY,
  contributionKey,
  fmtMtr,
  fmtMtrSigned,
  fmtUsd,
  summarizeLevels,
  valueKey,
} from '../utils/chartModel'

function CliffDriversBlock({ cliff }) {
  if (!cliff?.drivers?.length) {
    return null
  }

  return (
    <div className="chart-tooltip-divider">
      {cliff.kind === 'upcoming' ? (
        <p className="chart-tooltip-subtle">
          At {fmtUsd(cliff.targetIncome)}/yr in wages and salaries
        </p>
      ) : null}
      <p className="chart-tooltip-label">Main cliff drivers</p>
      {cliff.drivers.slice(0, 3).map((driver) => (
        <div key={driver.key} className="chart-tooltip-row">
          <span>{driver.label}</span>
          <span>{fmtUsd(Math.abs(driver.resource_effect_annual))}/yr</span>
        </div>
      ))}
    </div>
  )
}

function CliffOrChangeRow({ point, cliff }) {
  if (cliff) {
    return (
      <div className="chart-tooltip-row">
        <span>{cliff.kind === 'upcoming' ? 'Cliff on next step' : 'Cliff loss at this step'}</span>
        <span>{fmtUsd(-cliff.dropAnnual)}/yr</span>
      </div>
    )
  }

  if (point.has_previous_point) {
    return (
      <div className="chart-tooltip-row">
        <span>Change vs prior point</span>
        <span>{fmtUsd(point.net_change_display)}/yr</span>
      </div>
    )
  }

  return null
}

function IncomeTotalBody({ point, components, cliff }) {
  const summary = summarizeLevels(point, components)

  return (
    <>
      <p className="chart-tooltip-highlight">Net income: {fmtUsd(point.net)}/yr</p>
      <div className="chart-tooltip-divider">
        <div className="chart-tooltip-row">
          <span>Wages and salaries</span>
          <span>{fmtUsd(point.earnings)}/yr</span>
        </div>
        <div className="chart-tooltip-row">
          <span>Benefits</span>
          <span>{fmtUsd(summary.benefits)}/yr</span>
        </div>
        <div className="chart-tooltip-row">
          <span>Federal refundable tax credits</span>
          <span>{fmtUsd(summary.federalCredits)}/yr</span>
        </div>
        <div className="chart-tooltip-row">
          <span>State refundable tax credits</span>
          <span>{fmtUsd(summary.stateCredits)}/yr</span>
        </div>
        {summary.costs > 0 ? (
          <div className="chart-tooltip-row">
            <span>Household costs</span>
            <span>{fmtUsd(summary.costs)}/yr</span>
          </div>
        ) : null}
        <div className="chart-tooltip-row">
          <span>Federal taxes</span>
          <span>{fmtUsd(summary.federalTaxes)}/yr</span>
        </div>
        <div className="chart-tooltip-row">
          <span>State taxes</span>
          <span>{fmtUsd(summary.stateTaxes)}/yr</span>
        </div>
        <CliffOrChangeRow point={point} cliff={cliff} />
        {point.marginal_tax_rate !== null && point.marginal_tax_rate !== undefined ? (
          <div className="chart-tooltip-row">
            <span>Marginal tax rate</span>
            <span>{fmtMtr(point.marginal_tax_rate)}</span>
          </div>
        ) : null}
      </div>
    </>
  )
}

function IncomeByProgramBody({ point, components, isVisible }) {
  const rows = components
    .filter((component) => isVisible(component.key))
    .map((component) => ({ component, value: Number(point[valueKey(component)] || 0) }))
    .filter(({ value }) => Math.abs(value) > 0)

  return (
    <>
      <p className="chart-tooltip-highlight">Net income: {fmtUsd(point.net)}/yr</p>
      <div className="chart-tooltip-divider">
        {isVisible('earnings') && point.earnings > 0 ? (
          <div className="chart-tooltip-row">
            <span>Wages and salaries</span>
            <span>{fmtUsd(point.earnings)}/yr</span>
          </div>
        ) : null}
        {rows.map(({ component, value }) => (
          <div key={component.key} className="chart-tooltip-row">
            <span>{component.label}</span>
            <span>{fmtUsd(value)}/yr</span>
          </div>
        ))}
        {point.marginal_tax_rate !== null && point.marginal_tax_rate !== undefined ? (
          <div className="chart-tooltip-row">
            <span>Marginal tax rate</span>
            <span>{fmtMtr(point.marginal_tax_rate)}</span>
          </div>
        ) : null}
      </div>
    </>
  )
}

function MtrBody({ point, components, isVisible, byProgram, showResidual }) {
  const rows = byProgram
    ? components
      .filter((component) => isVisible(component.key))
      .map((component) => ({
        key: component.key,
        label: component.label,
        value: Number(point[contributionKey(component)] || 0),
      }))
      .concat(showResidual && isVisible(MTR_OTHER_KEY)
        ? [{ key: MTR_OTHER_KEY, label: 'Other changes', value: Number(point[MTR_OTHER_KEY] || 0) }]
        : [])
      .filter(({ value }) => Math.abs(value) >= 0.005)
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    : []

  return (
    <>
      <p className="chart-tooltip-highlight">
        Marginal tax rate: {fmtMtr(point.marginal_tax_rate)}
      </p>
      {Number(point.marginal_tax_rate) > MTR_CAP ? (
        <p className="chart-tooltip-subtle">
          Above the 100% chart cap — net income falls over this step.
        </p>
      ) : null}
      <div className="chart-tooltip-divider">
        <div className="chart-tooltip-row">
          <span>Net income</span>
          <span>{fmtUsd(point.net)}/yr</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="chart-tooltip-row">
            <span>{row.label}</span>
            <span>{fmtMtrSigned(row.value)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
  measure,
  composition,
  components,
  isVisible,
  resolveCliff,
  showResidual,
}) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload
  const cliff = resolveCliff(point)
  const byProgram = composition === 'by_program'

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-kicker">Wages and salaries: {fmtUsd(label)}/yr</p>
      {measure === 'mtr' ? (
        <MtrBody
          point={point}
          components={components}
          isVisible={isVisible}
          byProgram={byProgram}
          showResidual={showResidual}
        />
      ) : byProgram ? (
        <IncomeByProgramBody point={point} components={components} isVisible={isVisible} />
      ) : (
        <IncomeTotalBody point={point} components={components} cliff={cliff} />
      )}
      <CliffDriversBlock cliff={cliff} />
    </div>
  )
}

export default ChartTooltip
