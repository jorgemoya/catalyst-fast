import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Countries and their states/provinces, for the shipping estimator and address
 * forms.
 *
 * The single most cacheable data in the storefront — a country list changes on
 * geopolitical timescales — so it gets the `settings` profile and is shared by
 * every shopper. Catalyst refetched this per render of any address form.
 */

const CountriesQuery = graphql(`
  query Countries {
    geography {
      countries {
        entityId
        code
        name
        statesOrProvinces {
          entityId
          name
          abbreviation
        }
      }
    }
  }
`);

export interface StateOrProvince {
  id: number;
  name: string;
  abbreviation: string;
}

export interface Country {
  id: number;
  code: string;
  name: string;
  states: StateOrProvince[];
}

/**
 * US state abbreviations BigCommerce returns that collide with each other.
 *
 * Ported from Catalyst, where it is a genuine footgun rather than trivia: the
 * checkout API matches a state by **abbreviation**, and these are ambiguous, so
 * submitting one can silently resolve to the wrong state and quote the wrong
 * shipping cost. Matching by full name for these avoids it.
 */
export const AMBIGUOUS_US_ABBREVIATIONS = new Set(['AA', 'AE', 'AP']);

export async function getCountries(): Promise<Country[]> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: CountriesQuery });

  return (data.geography.countries ?? []).map((country) => ({
    id: country.entityId,
    code: country.code,
    name: country.name,
    states: country.statesOrProvinces.map((state) => ({
      id: state.entityId,
      name: state.name,
      abbreviation: state.abbreviation,
    })),
  }));
}
