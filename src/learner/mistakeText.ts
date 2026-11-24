import type { MistakeCode } from '../maths/types'

export const mistakeText: Record<MistakeCode, string> = {
  perim_two_sides_only: 'Adds only two sides when finding perimeter',
  perim_area_confused: 'Mixes up perimeter and area',
  area_added_not_multiplied: 'Adds the sides instead of multiplying them when finding area',
  units_missing: 'Forgets to write the units',
  units_wrong_power: 'Uses length units for area, or square units for length',
  square_side_vs_perimeter: 'Mixes up the side of a square with its perimeter',
  rectilinear_missed_edge: 'Misses a side when finding the perimeter of an L-shape',
}
