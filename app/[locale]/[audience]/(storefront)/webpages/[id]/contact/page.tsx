import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getWebpage } from '~/data/content';
import { decodeNodeId } from '~/domain/node-id';
import { toContactFields } from '~/domain/contact';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { Prose } from '~/ui/patterns/prose';
import { Skeleton } from '~/ui/primitives/skeleton';

import { ContactForm } from './_components/contact-form';
import { getRecaptchaSettings } from '~/data/recaptcha';

/**
 * A merchant's contact page: WYSIWYG body plus a form whose optional fields the
 * merchant chooses in the control panel.
 *
 * The field list is server data, so it is resolved here and handed to the client
 * island as a plain description — the island takes no data of its own beyond what
 * it needs to draw inputs.
 */

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getWebpage(decodeNodeId((await params).id));

  if (!page) {
    return {};
  }

  return {
    title: page.seo.pageTitle || page.name,
    description: page.seo.metaDescription || undefined,
    keywords: page.seo.metaKeywords || undefined,
    alternates: { canonical: page.path },
  };
}

export default function ContactWebPage({ params }: Props) {
  return (
    <Suspense fallback={<ContactSkeleton />}>
      <ContactContent params={params} />
    </Suspense>
  );
}

async function ContactContent({ params }: Props) {
  const id = decodeNodeId((await params).id);
  const page = await getWebpage(id);

  if (!page || page.kind !== 'contact') {
    notFound();
  }

  return (
    <article className="page-container py-8">
      <Breadcrumbs items={page.breadcrumbs} />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{page.name}</h1>
      {page.body && <Prose className="mt-6" html={page.body} />}

      <ContactForm
        fields={toContactFields(page.contactFields)}
        nodeId={id}
        siteKey={(await getRecaptchaSettings())?.siteKey ?? null}
      />
    </article>
  );
}

function ContactSkeleton() {
  return (
    <div className="page-container py-8">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-9 w-72" />
      <div className="mt-8 flex max-w-lg flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}
