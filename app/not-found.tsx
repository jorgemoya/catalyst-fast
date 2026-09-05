import { Link } from '~/ui/primitives/link';
import { t } from '~/lib/i18n/messages';

export default function NotFound() {
  return (
    <main className="page-container flex min-h-dvh flex-col justify-center gap-4 py-16" id="main">
      <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('NotFound.title')}</h1>
      <p className="max-w-prose text-muted">{t('NotFound.subtitle')}</p>
      <Link className="text-primary underline underline-offset-4 hover:text-primary-hover" href="/">
        {t('NotFound.home')}
      </Link>
    </main>
  );
}
