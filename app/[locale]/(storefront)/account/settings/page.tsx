import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCustomerProfile } from '~/data/customer/customer';

import { ChangePasswordForm } from './_components/change-password-form';
import { NewsletterForm } from './_components/newsletter-form';
import { ProfileForm } from './_components/profile-form';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.settings'),
  robots: { index: false, follow: false },
  };
}

export default async function SettingsPage() {
  const t = await getT();

  const profile = await getCustomerProfile();

  // The layout already redirects a signed-out visitor, so a null here means the
  // session is valid but BigCommerce returned no customer — a genuine fault.
  if (!profile) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="mb-6 text-lg font-semibold">{t('Account.profile')}</h2>
        <ProfileForm profile={profile} />
      </section>

      <section>
        <h2 className="mb-6 text-lg font-semibold">{t('Account.newsletterHeading')}</h2>
        <NewsletterForm subscribed={profile.isSubscribedToNewsletter} />
      </section>

      <section>
        <h2 className="mb-6 text-lg font-semibold">{t('Auth.security')}</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
