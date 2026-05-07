export function getStateProgramOverrides(metadata, stateCode) {
  return metadata?.state_program_overrides?.[stateCode] || {}
}

export function applyStateProgramLabels(programs = [], metadata, stateCode) {
  const overrides = getStateProgramOverrides(metadata, stateCode)
  return (programs || []).map((program) => {
    const override = overrides[program.key] || {}
    return {
      ...program,
      ...override,
      label: override.label || program.label,
      short_label: override.short_label || program.short_label,
      description: override.description || program.description,
    }
  })
}
