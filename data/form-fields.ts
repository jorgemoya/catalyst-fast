import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { toCustomFields } from '~/domain/form-fields';
import type { CustomFormField, PasswordRules } from '~/domain/form-fields';
import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Merchant-configured form fields, from BigCommerce.
 *
 * **These exist because a merchant switched them on**, and a storefront that
 * ignores them loses data that was deliberately asked for — silently, since
 * every custom field is optional on the mutation input and nothing errors.
 * Verified against this store: the address form carries "Residence Type" and
 * "Delivery Notes", neither of which the static form rendered.
 *
 * The customer form on this store has none — its only non-obvious entry,
 * "Exclusive Offers", is a **built-in** (`ReceiveMarketingEmails`) rather than a
 * custom field, and `RegisterCustomerInput` has no member to carry it. Catalyst
 * leaves it out of the registration layout for the same reason and manages the
 * preference from account settings instead, which is where this storefront's
 * newsletter toggle lives too.
 *
 * Only the **custom** fields are returned. The built-ins (email, password, first
 * name, address lines…) stay hand-written: they are required by the mutation's
 * own typed input rather than by `formFields`, they need bespoke handling —
 * cascading country/state, password confirmation, autocomplete hints — and
 * generating them would mean rebuilding all of that generically for no gain.
 * Catalyst renders both from the same list; this splits them because only one
 * half actually varies per store.
 *
 * `passwordComplexitySettings` comes along because it is the same settings read
 * and the alternative is hardcoding a minimum. This store's is **7**, while the
 * hand-written schema assumed 8 — stricter than the store, so a password
 * BigCommerce accepts was being rejected before it ever left the browser.
 */

const FormFieldsQuery = graphql(`
  query StoreFormFields {
    site {
      settings {
        formFields {
          customer {
            ...FormFieldFragment
          }
          shippingAddress {
            ...FormFieldFragment
          }
        }
        customers {
          passwordComplexitySettings {
            minimumPasswordLength
            requireLowerCase
            requireUpperCase
            requireNumbers
          }
        }
      }
    }
  }

  fragment FormFieldFragment on FormField {
    __typename
    entityId
    label
    sortOrder
    isBuiltIn
    isRequired
    ... on TextFormField {
      maxLength
      defaultText
    }
    ... on MultilineTextFormField {
      rows
      defaultText
    }
    ... on NumberFormField {
      minNumber
      maxNumber
      defaultNumber
    }
    ... on DateFormField {
      minDate
      maxDate
      defaultDate
    }
    ... on PicklistFormField {
      choosePrefix
      options {
        entityId
        label
      }
    }
    ... on RadioButtonsFormField {
      options {
        entityId
        label
      }
    }
    ... on CheckboxesFormField {
      options {
        entityId
        label
      }
    }
  }
`);

export interface StoreFormFields {
  /** Custom fields on the customer (registration and account settings). */
  customer: CustomFormField[];
  /** Custom fields on an address. */
  address: CustomFormField[];
  password: PasswordRules;
}

export async function getFormFields(): Promise<StoreFormFields> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: FormFieldsQuery });
  const settings = data.site.settings;
  const complexity = settings?.customers?.passwordComplexitySettings;

  return {
    customer: toCustomFields(settings?.formFields.customer ?? []),
    address: toCustomFields(settings?.formFields.shippingAddress ?? []),
    password: {
      minLength: complexity?.minimumPasswordLength ?? 7,
      requireLowerCase: complexity?.requireLowerCase ?? false,
      requireUpperCase: complexity?.requireUpperCase ?? false,
      requireNumbers: complexity?.requireNumbers ?? false,
    },
  };
}
