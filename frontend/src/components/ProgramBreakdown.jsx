import { formatCurrency } from '../dataLookup'

function ProgramBreakdown({ programs }) {
  const displayPrograms = [...(programs || [])].sort((left, right) => right.annual - left.annual)

  return (
    <div>
      {displayPrograms.map((program) => (
        <div key={program.key} className="breakdown-row">
          <div>
            <div className="breakdown-label">{program.label}</div>
            <div className="program-description">{program.description}</div>
          </div>
          <div className={`breakdown-value ${program.annual > 0 ? 'positive' : ''}`}>
            {formatCurrency(program.annual)}/yr
          </div>
        </div>
      ))}
      <div className="breakdown-divider" />
      <div className="breakdown-row total">
        <span className="breakdown-label">Total benefits + refundable tax credits</span>
        <span className="breakdown-value positive">
          {formatCurrency(displayPrograms.reduce((sum, item) => sum + item.annual, 0))}/yr
        </span>
      </div>
    </div>
  )
}

export default ProgramBreakdown
