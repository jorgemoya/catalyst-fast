import { getStoreSettings } from '~/data/settings';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

export async function StoreLogo({ className }: { className?: string }) {
  const { logo, storeName } = await getStoreSettings();

  return (
    <Link aria-label={storeName} className={className} href="/">
      {logo.type === 'image' ? (
        // Height-constrained rather than width-constrained: merchant logos vary
        // wildly in aspect ratio, and the header's fixed height is the real
        // constraint. `priority` because this is above the fold on every page.
        <Image
          alt={logo.alt}
          className="h-8 w-auto object-contain"
          height={32}
          priority
          src={logo.src}
          width={160}
        />
      ) : (
        <span className="text-lg font-semibold tracking-tight">{logo.text}</span>
      )}
    </Link>
  );
}
