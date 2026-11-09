// policyengine-us makes a family categorically eligible for Head Start, Early
// Head Start and free school meals for the whole year once it gets SNAP in any
// month (is_head_start_categorically_eligible and
// meets_school_meal_categorical_eligibility sum SNAP over the year), so the
// chart counts a full year of each even when SNAP starts late in the year.
// PolicyEngine/policyengine-us#10766 counts them from the first month of SNAP
// instead; drop this note once CliffWatch's engine carries that change.
export const SNAP_MONTH_PROGRAMS = ['head_start', 'early_head_start', 'free_school_meals']

export const SNAP_MONTH_NOTE =
  'Once a family gets SNAP in any month, CliffWatch counts a full year of Head Start, Early Head Start and free school meals, including the months before its SNAP starts.'

const positive = (value) => Number(value) > 0

// The note, for a series with a point where the household gets SNAP and one of
// these programs; otherwise null. Series points carry each program's annual
// value under its own key (point.snap, point.head_start), as the API's
// compute_series and buildSeriesDataFromResponse both return them and as
// chartModel reads them.
export function snapMonthNote(data) {
  const applies = (data || []).some(
    (point) =>
      positive(point?.snap) && SNAP_MONTH_PROGRAMS.some((key) => positive(point?.[key])),
  )
  return applies ? SNAP_MONTH_NOTE : null
}
