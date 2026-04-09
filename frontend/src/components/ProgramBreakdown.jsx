import { formatCurrency } from '../dataLookup'

function ProgramBreakdown({ programs }) {
  const displayPrograms = [...(programs || [])].sort((left, right) => right.monthly - left.monthly)

  return (
    <div>
      {displayPrograms.map((program) => (
        <div key={program.key} className="breakdown-row">
          <div>
            <div className="breakdown-label">{program.label}</div>
            <div className="program-description">{program.description}</div>
          </div>
          <div className={`breakdown-value ${program.monthly > 0 ? 'positive' : ''}`}>
            {formatCurrency(program.monthly)}/mo
          </div>
        </div>
      ))}
      <div className="breakdown-divider" />
      <div className="breakdown-row total">
        <span className="breakdown-label">Total modeled support</span>
        <span className="breakdown-value positive">
          {formatCurrency(displayPrograms.reduce((sum, item) => sum + item.monthly, 0))}/mo
        </span>
      </div>
    </div>
  )
}

export default ProgramBreakdown
