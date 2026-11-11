import { formatCurrency } from '../dataLookup.js'

// policyengine-us makes a household categorically eligible for Head Start, Early
// Head Start and free school meals for the whole year once it gets SNAP in any
// month, while the chart shows January's SNAP times 12. So near SNAP's limits, a
// household that gets SNAP only from October shows a full year of these programs
// beside no SNAP. /api/series marks each such point: `snap_months` lists the
// months with SNAP, and `part_year_snap_programs` lists the programs the
// household gets for the whole year only through those months.
// PolicyEngine/policyengine-us#10766 would count these programs from the first
// month of SNAP. Drop or rework this note once CliffWatch charts SNAP's annual
// sum (#45) or runs a policyengine-us release with #10766.
export const SNAP_MONTH_PROGRAMS = ['head_start', 'early_head_start', 'free_school_meals']

const PROGRAM_NAMES = {
  head_start: 'Head Start',
  early_head_start: 'Early Head Start',
  free_school_meals: 'free school meals',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// USDA updates SNAP's income limits and benefits each October 1.
const OCTOBER = 10

function snapMonths(point) {
  const months = point?.snap_months
  return Array.isArray(months)
    ? months.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    : []
}

// The programs a point marks, when its SNAP covers some months but not all twelve.
export function partYearPrograms(point) {
  const months = snapMonths(point)
  const marked = point?.part_year_snap_programs
  if (!months.length || months.length >= 12 || !Array.isArray(marked)) return []
  return SNAP_MONTH_PROGRAMS.filter((key) => marked.includes(key) && Number(point?.[key]) > 0)
}

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Runs of consecutive marked points, as wage ranges.
function wageRanges(points, marked) {
  const ranges = []
  points.forEach((point, index) => {
    if (!marked[index]) return
    const wages = Number(point?.earned_income) || 0
    if (index > 0 && marked[index - 1]) {
      ranges[ranges.length - 1].to = wages
    } else {
      ranges.push({ from: wages, to: wages })
    }
  })
  const phrases = ranges.map(({ from, to }, index) => {
    if (from === to) return `${index === 0 ? 'At' : 'at'} ${formatCurrency(from)}`
    return `${index === 0 ? 'From' : 'from'} ${formatCurrency(from)} to ${formatCurrency(to)}`
  })
  return `${joinNames(phrases)} of annual wages`
}

// The months sentence for marked points without January SNAP.
function monthsSentence(monthSets) {
  const [first] = monthSets
  const same = monthSets.every((months) => months.join() === first.join())
  const contiguous = first.every((month, index) => index === 0 || month === first[index - 1] + 1)
  if (!same || !contiguous) return 'This household gets SNAP there in some months, but not in January.'
  const start = first[0]
  const end = first[first.length - 1]
  if (end === 12) {
    const update = start === OCTOBER ? ', when USDA updates SNAP\'s income limits and benefits' : ''
    return `This household gets no SNAP until ${MONTH_NAMES[start - 1]}${update}.`
  }
  return `This household gets SNAP only from ${MONTH_NAMES[start - 1]} to ${MONTH_NAMES[end - 1]}.`
}

// The note for a series with a point that marks a program, otherwise null.
export function snapMonthNote(data) {
  const points = Array.isArray(data) ? data : []
  const programsByPoint = points.map(partYearPrograms)
  const marked = programsByPoint.map((programs) => programs.length > 0)
  if (!marked.some(Boolean)) return null

  const programs = joinNames(
    SNAP_MONTH_PROGRAMS
      .filter((key) => programsByPoint.some((keys) => keys.includes(key)))
      .map((key) => PROGRAM_NAMES[key]),
  )
  const where = wageRanges(points, marked)
  const monthSets = points.filter((_, index) => marked[index]).map(snapMonths)
  const rule = `We count January's SNAP for all twelve months, and a full year of ${programs} for any household that gets SNAP in any month.`

  if (monthSets.some((months) => months.includes(1))) {
    return `${where}, this household gets SNAP in only part of the year. ${rule}`
  }
  return `${where}, you'll see ${programs} without SNAP. ${monthsSentence(monthSets)} ${rule}`
}
