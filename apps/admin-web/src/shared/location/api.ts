import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api/client'

/**
 * PD-45 (plan §5.1): the countries and first-level subdivisions the location
 * pickers offer, from GET /geo/countries and GET /geo/countries/:cc/subdivisions
 * (apps/api/src/geo). Reference data about no one: it changes only with a new
 * dataset build, so a session keeps it.
 */
export interface Names {
  en: string
  ar: string
}

export interface GeoCountry extends Names {
  code: string
  /** The field's name for this country: Governorate, Emirate, State ... */
  label: Names
  hasSubdivisions: boolean
  /** 0.. for the academy's markets (Egypt first), else null. */
  pinned: number | null
}

export interface GeoSubdivision extends Names {
  code: string
}

export interface GeoCountries {
  version: string
  defaultLabel: Names
  countries: GeoCountry[]
}

export interface GeoSubdivisions {
  version: string
  country: string
  label: Names
  subdivisions: GeoSubdivision[]
}

export const geoKeys = {
  countries: ['geo', 'countries'] as const,
  subdivisions: (country: string) => ['geo', 'subdivisions', country] as const,
}

export const geoApi = {
  countries: () => api.get<GeoCountries>('/geo/countries'),
  subdivisions: (country: string) => api.get<GeoSubdivisions>(`/geo/countries/${encodeURIComponent(country)}/subdivisions`),
}

const KEEP = { staleTime: Infinity, gcTime: Infinity } as const

export function useCountries() {
  return useQuery({ queryKey: geoKeys.countries, queryFn: geoApi.countries, ...KEEP })
}

/** A country's subdivisions; nothing is fetched without a country, or for one that has none. */
export function useSubdivisions(country: string | null, enabled = true) {
  return useQuery({
    queryKey: geoKeys.subdivisions(country ?? ''),
    queryFn: () => geoApi.subdivisions(country!),
    enabled: enabled && !!country,
    ...KEEP,
  })
}
